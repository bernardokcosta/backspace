#include "sdr_texture.h"

#include <d2d1_1.h>
#include <d2d1effects.h>
#include <d2d1effects_2.h>
#include <dxgi1_2.h>
#include <d3dcompiler.h>
#include <DirectXPackedVector.h>

#include <chrono>
#include <bit>
#include <cmath>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <thread>

using Microsoft::WRL::ComPtr;

namespace backspace {
namespace {
class TextureLock {
 public:
  explicit TextureLock(ID3D11Texture2D* texture);
  ~TextureLock() { if (mutex_) mutex_->ReleaseSync(0); }
 private:
  ComPtr<IDXGIKeyedMutex> mutex_;
};

void check(HRESULT result, const char* operation) {
  if (FAILED(result)) {
    std::ostringstream message;
    message << operation << " failed (0x" << std::hex << uint32_t(result) << ')';
    throw std::runtime_error(message.str());
  }
}

TextureLock::TextureLock(ID3D11Texture2D* texture) {
  check(texture->QueryInterface(IID_PPV_ARGS(&mutex_)), "Get texture ownership mutex");
  const HRESULT result = mutex_->AcquireSync(0, 2000);
  if (result != S_OK) {
    mutex_.Reset();
    throw std::runtime_error("Acquire SDR texture ownership timed out or failed");
  }
}

void wait_for_gpu(ID3D11Device* device, ID3D11DeviceContext* context) {
  D3D11_QUERY_DESC description{D3D11_QUERY_EVENT, 0};
  ComPtr<ID3D11Query> completed;
  check(device->CreateQuery(&description, &completed), "Create GPU completion query");
  context->End(completed.Get());
  context->Flush();
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
  for (;;) {
    const HRESULT status = context->GetData(completed.Get(), nullptr, 0, 0);
    if (status == S_OK) return;
    check(status, "Wait for SDR GPU processing");
    if (std::chrono::steady_clock::now() >= deadline) throw std::runtime_error("SDR GPU processing timed out");
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
}

void validate_source(ID3D11Texture2D* source, ID3D11Device* device, uint32_t width, uint32_t height) {
  if (!source || !width || !height || width > 16384 || height > 16384 || uint64_t(width) * height > 33554432) {
    throw std::invalid_argument("Invalid GPU source content dimensions");
  }
  D3D11_TEXTURE2D_DESC description{};
  source->GetDesc(&description);
  if (description.Format != DXGI_FORMAT_R16G16B16A16_FLOAT || description.SampleDesc.Count != 1
      || description.ArraySize != 1 || description.MipLevels != 1 || width > description.Width || height > description.Height) {
    throw std::invalid_argument("GPU source is not a bounded FP16 capture surface");
  }
  ComPtr<ID3D11Device> source_device;
  source->GetDevice(&source_device);
  if (source_device.Get() != device) throw std::invalid_argument("GPU capture source belongs to another device");
}
}

struct SdrTextureConverter::State {
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> immediate;
  ComPtr<ID2D1Factory1> factory;
  ComPtr<ID2D1Device> d2d_device;
  ComPtr<ID2D1DeviceContext> context;
  ComPtr<ID2D1ColorContext> linear;
  ComPtr<ID2D1ColorContext> srgb;
  ComPtr<ID3D11ComputeShader> peak_shader;
  ComPtr<ID3D11Buffer> peak_dimensions;
  ComPtr<ID3D11Buffer> peak_result;
  ComPtr<ID3D11Buffer> peak_readback;
  ComPtr<ID3D11UnorderedAccessView> peak_view;
  ComPtr<ID3D11Texture2D> peak_source;
  ComPtr<ID3D11ShaderResourceView> peak_source_view;
  uint32_t peak_width = 0;
  uint32_t peak_height = 0;
};

SdrTexture::~SdrTexture() {
  if (handle) CloseHandle(handle);
  texture.Reset();
  pool_capacity.reset();
}

SdrTextureConverter::SdrTextureConverter() : state_(std::make_unique<State>()) {
  const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
  check(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
      D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels, 2, D3D11_SDK_VERSION,
      &state_->device, nullptr, &state_->immediate), "Create hardware D3D11 device");
  D2D1_FACTORY_OPTIONS options{};
  check(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, options, state_->factory.GetAddressOf()), "Create D2D factory");
  ComPtr<IDXGIDevice> dxgi;
  check(state_->device.As(&dxgi), "Get DXGI device");
  check(state_->factory->CreateDevice(dxgi.Get(), &state_->d2d_device), "Create D2D device");
  check(state_->d2d_device->CreateDeviceContext(D2D1_DEVICE_CONTEXT_OPTIONS_NONE, &state_->context), "Create D2D context");
  state_->context->SetUnitMode(D2D1_UNIT_MODE_PIXELS);
  state_->context->SetPrimitiveBlend(D2D1_PRIMITIVE_BLEND_COPY);
  const D2D1_RENDERING_CONTROLS controls{D2D1_BUFFER_PRECISION_16BPC_FLOAT, {0, 0}};
  state_->context->SetRenderingControls(controls);
  check(state_->context->CreateColorContext(D2D1_COLOR_SPACE_SCRGB, nullptr, 0, &state_->linear), "Create linear color context");
  check(state_->context->CreateColorContext(D2D1_COLOR_SPACE_SRGB, nullptr, 0, &state_->srgb), "Create SDR color context");
}

SdrTextureConverter::~SdrTextureConverter() = default;

ID3D11Device* SdrTextureConverter::device() const noexcept { return state_->device.Get(); }

float SdrTextureConverter::measurePeakNits(ID3D11Texture2D* source, uint32_t width, uint32_t height) {
  validate_source(source, state_->device.Get(), width, height);
  if (!state_->peak_shader) {
    // A monitor's advertised peak is not the captured image's MaxCLL. Reduce
    // the actual FP16 RGB samples on the GPU; only two uints return to the CPU.
    constexpr char shader[] = R"hlsl(
Texture2D<uint4> source : register(t0);
RWByteAddressBuffer result : register(u0);
cbuffer Dimensions : register(b0) { uint2 size; uint2 padding; };
groupshared uint peak;
groupshared uint invalid;
[numthreads(16, 16, 1)]
void main(uint3 position : SV_DispatchThreadID, uint index : SV_GroupIndex) {
  if (index == 0) { peak = 0; invalid = 0; }
  GroupMemoryBarrierWithGroupSync();
  uint value = 0;
  if (all(position.xy < size)) {
    uint4 raw = source.Load(int3(position.xy, 0));
    // Inspect the original half-float exponent before typed float sampling
    // or compiler/GPU NaN handling can canonicalize an invalid producer.
    if (any((raw & 0x7c00) == 0x7c00)) InterlockedOr(invalid, 1);
    else {
      float3 rgb = f16tof32(raw.rgb);
      float maximum = max(rgb.r, max(rgb.g, rgb.b));
      if (maximum > 0.0) value = asuint(maximum);
    }
  }
  InterlockedMax(peak, value);
  GroupMemoryBarrierWithGroupSync();
  if (index == 0) { result.InterlockedMax(0, peak); result.InterlockedOr(4, invalid); }
}
)hlsl";
    ComPtr<ID3DBlob> compiled;
    ComPtr<ID3DBlob> errors;
    check(D3DCompile(shader, sizeof(shader) - 1, "backspace-sdr-peak", nullptr, nullptr, "main", "cs_5_0",
        D3DCOMPILE_ENABLE_STRICTNESS | D3DCOMPILE_IEEE_STRICTNESS | D3DCOMPILE_OPTIMIZATION_LEVEL3,
        0, &compiled, &errors), "Compile HDR peak reduction");
    ComPtr<ID3D11ComputeShader> peak_shader;
    check(state_->device->CreateComputeShader(compiled->GetBufferPointer(), compiled->GetBufferSize(), nullptr, &peak_shader), "Create HDR peak reduction");
    D3D11_BUFFER_DESC dimensions{};
    dimensions.ByteWidth = 16;
    dimensions.Usage = D3D11_USAGE_DEFAULT;
    dimensions.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
    check(state_->device->CreateBuffer(&dimensions, nullptr, &state_->peak_dimensions), "Create HDR dimension buffer");
    D3D11_BUFFER_DESC result{};
    result.ByteWidth = 8;
    result.Usage = D3D11_USAGE_DEFAULT;
    result.BindFlags = D3D11_BIND_UNORDERED_ACCESS;
    result.MiscFlags = D3D11_RESOURCE_MISC_BUFFER_ALLOW_RAW_VIEWS;
    check(state_->device->CreateBuffer(&result, nullptr, &state_->peak_result), "Create HDR peak result");
    D3D11_UNORDERED_ACCESS_VIEW_DESC view{};
    view.Format = DXGI_FORMAT_R32_TYPELESS;
    view.ViewDimension = D3D11_UAV_DIMENSION_BUFFER;
    view.Buffer.NumElements = 2;
    view.Buffer.Flags = D3D11_BUFFER_UAV_FLAG_RAW;
    check(state_->device->CreateUnorderedAccessView(state_->peak_result.Get(), &view, &state_->peak_view), "Create HDR peak view");
    result.Usage = D3D11_USAGE_STAGING;
    result.BindFlags = 0;
    result.MiscFlags = 0;
    result.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    check(state_->device->CreateBuffer(&result, nullptr, &state_->peak_readback), "Create HDR peak readback");
    state_->peak_shader = std::move(peak_shader);
  }
  if (!state_->peak_source || !state_->peak_source_view || state_->peak_width != width || state_->peak_height != height) {
    state_->peak_source_view.Reset();
    state_->peak_source.Reset();
    D3D11_TEXTURE2D_DESC description{};
    description.Width = width; description.Height = height;
    description.ArraySize = 1; description.MipLevels = 1;
    description.Format = DXGI_FORMAT_R16G16B16A16_TYPELESS;
    description.SampleDesc.Count = 1;
    description.Usage = D3D11_USAGE_DEFAULT;
    description.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    check(state_->device->CreateTexture2D(&description, nullptr, &state_->peak_source), "Create raw FP16 peak input");
    D3D11_SHADER_RESOURCE_VIEW_DESC view{};
    view.Format = DXGI_FORMAT_R16G16B16A16_UINT;
    view.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
    view.Texture2D.MipLevels = 1;
    check(state_->device->CreateShaderResourceView(state_->peak_source.Get(), &view, &state_->peak_source_view), "Create raw FP16 peak view");
    state_->peak_width = width; state_->peak_height = height;
  }
  auto& context = state_->immediate;
  const D3D11_BOX content{0, 0, 0, width, height, 1};
  context->CopySubresourceRegion(state_->peak_source.Get(), 0, 0, 0, 0, source, 0, &content);
  const uint32_t dimensions[] = {width, height, 0, 0};
  const UINT zeros[] = {0, 0, 0, 0};
  context->UpdateSubresource(state_->peak_dimensions.Get(), 0, nullptr, dimensions, 0, 0);
  context->ClearUnorderedAccessViewUint(state_->peak_view.Get(), zeros);
  ID3D11ShaderResourceView* sources[] = {state_->peak_source_view.Get()};
  ID3D11UnorderedAccessView* results[] = {state_->peak_view.Get()};
  ID3D11Buffer* constants[] = {state_->peak_dimensions.Get()};
  context->CSSetShader(state_->peak_shader.Get(), nullptr, 0);
  context->CSSetShaderResources(0, 1, sources);
  context->CSSetUnorderedAccessViews(0, 1, results, nullptr);
  context->CSSetConstantBuffers(0, 1, constants);
  context->Dispatch((width + 15) / 16, (height + 15) / 16, 1);
  sources[0] = nullptr; results[0] = nullptr; constants[0] = nullptr;
  context->CSSetShaderResources(0, 1, sources);
  context->CSSetUnorderedAccessViews(0, 1, results, nullptr);
  context->CSSetConstantBuffers(0, 1, constants);
  context->CSSetShader(nullptr, nullptr, 0);
  context->CopyResource(state_->peak_readback.Get(), state_->peak_result.Get());
  wait_for_gpu(state_->device.Get(), context.Get());
  D3D11_MAPPED_SUBRESOURCE mapped{};
  check(context->Map(state_->peak_readback.Get(), 0, D3D11_MAP_READ, 0, &mapped), "Read reduced HDR peak");
  uint32_t values[2];
  std::memcpy(values, mapped.pData, sizeof(values));
  context->Unmap(state_->peak_readback.Get(), 0);
  if (values[1] != 0) throw std::invalid_argument("Non-finite HDR capture samples");
  return std::bit_cast<float>(values[0]) * 80.0f;
}

std::shared_ptr<SdrTexture> SdrTextureConverter::convertTexture(ID3D11Texture2D* source,
    uint32_t content_width, uint32_t content_height, uint32_t output_width,
    uint32_t output_height, float white_nits, float max_nits) {
  if (!source || !content_width || !content_height || !output_width || !output_height
      || content_width > 16384 || content_height > 16384 || output_width > 16384 || output_height > 16384
      || uint64_t(content_width) * content_height > 33554432 || uint64_t(output_width) * output_height > 33554432
      || !std::isfinite(white_nits) || !std::isfinite(max_nits) || white_nits <= 0
      || white_nits > 10000 || max_nits < white_nits || max_nits > 10000) {
    throw std::invalid_argument("Invalid GPU capture dimensions or luminance metadata");
  }
  validate_source(source, state_->device.Get(), content_width, content_height);
  ComPtr<IDXGISurface> surface;
  check(source->QueryInterface(IID_PPV_ARGS(&surface)), "Get FP16 capture surface");
  ComPtr<ID2D1Bitmap1> input;
  const auto properties = D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_NONE,
      D2D1::PixelFormat(DXGI_FORMAT_R16G16B16A16_FLOAT, D2D1_ALPHA_MODE_IGNORE), 96, 96, state_->linear.Get());
  check(state_->context->CreateBitmapFromDxgiSurface(surface.Get(), &properties, &input), "Import FP16 capture without CPU readback");
  return render(input.Get(), content_width, content_height, output_width, output_height, white_nits, max_nits);
}

std::shared_ptr<SdrTexture> SdrTextureConverter::create(const std::vector<float>& pixels,
    uint32_t width, uint32_t height, float white_nits, float max_nits) {
  const uint64_t count = uint64_t(width) * height;
  if (!width || !height || width > 16384 || height > 16384 || count > 33554432
      || pixels.size() != count * 4 || !std::isfinite(white_nits) || !std::isfinite(max_nits)
      || white_nits <= 0 || white_nits > 10000 || max_nits < white_nits || max_nits > 10000) {
    throw std::invalid_argument("Invalid SDR dimensions or luminance metadata");
  }
  std::vector<DirectX::PackedVector::HALF> half(pixels.size());
  for (size_t i = 0; i < pixels.size(); ++i) {
    if (!std::isfinite(pixels[i]) || std::abs(pixels[i]) > 65504.0f) throw std::invalid_argument("Non-finite or unrepresentable HDR input");
    half[i] = DirectX::PackedVector::XMConvertFloatToHalf(pixels[i]);
  }

  ComPtr<ID2D1Bitmap1> input;
  const auto source_properties = D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_NONE,
      D2D1::PixelFormat(DXGI_FORMAT_R16G16B16A16_FLOAT, D2D1_ALPHA_MODE_IGNORE), 96, 96, state_->linear.Get());
  check(state_->context->CreateBitmap(D2D1::SizeU(width, height), half.data(), width * 8,
      source_properties, &input), "Create FP16 source");
  return render(input.Get(), width, height, width, height, white_nits, max_nits);
}

std::shared_ptr<SdrTexture> SdrTextureConverter::render(ID2D1Bitmap1* input,
    uint32_t content_width, uint32_t content_height, uint32_t width, uint32_t height,
    float white_nits, float max_nits) {
  auto& context = state_->context;
  ComPtr<ID2D1Image> image = input;
  ComPtr<ID2D1Effect> tone;
  if (max_nits > white_nits) {
    check(context->CreateEffect(CLSID_D2D1HdrToneMap, &tone), "Create HDR tone mapper");
    tone->SetInput(0, image.Get());
    check(tone->SetValue(D2D1_HDRTONEMAP_PROP_INPUT_MAX_LUMINANCE, max_nits), "Set HDR input luminance");
    check(tone->SetValue(D2D1_HDRTONEMAP_PROP_OUTPUT_MAX_LUMINANCE, white_nits), "Set SDR output luminance");
    check(tone->SetValue(D2D1_HDRTONEMAP_PROP_DISPLAY_MODE, D2D1_HDRTONEMAP_DISPLAY_MODE_SDR), "Set SDR display mode");
    tone->GetOutput(&image);
  }
  ComPtr<ID2D1Effect> white;
  check(context->CreateEffect(CLSID_D2D1WhiteLevelAdjustment, &white), "Create white-level adjustment");
  white->SetInput(0, image.Get());
  check(white->SetValue(D2D1_WHITELEVELADJUSTMENT_PROP_INPUT_WHITE_LEVEL, 80.0f), "Set scene reference white");
  check(white->SetValue(D2D1_WHITELEVELADJUSTMENT_PROP_OUTPUT_WHITE_LEVEL, white_nits), "Set display reference white");
  ComPtr<ID2D1Effect> color;
  check(context->CreateEffect(CLSID_D2D1ColorManagement, &color), "Create color management");
  color->SetInputEffect(0, white.Get());
  check(color->SetValue(D2D1_COLORMANAGEMENT_PROP_SOURCE_COLOR_CONTEXT, state_->linear.Get()), "Set source color space");
  check(color->SetValue(D2D1_COLORMANAGEMENT_PROP_DESTINATION_COLOR_CONTEXT, state_->srgb.Get()), "Set destination color space");

  auto result = std::make_shared<SdrTexture>();
  result->width = width;
  result->height = height;
  D3D11_TEXTURE2D_DESC description{};
  description.Width = width;
  description.Height = height;
  description.MipLevels = 1;
  description.ArraySize = 1;
  description.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  description.SampleDesc.Count = 1;
  description.Usage = D3D11_USAGE_DEFAULT;
  description.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
  description.MiscFlags = D3D11_RESOURCE_MISC_SHARED_NTHANDLE | D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX;
  check(state_->device->CreateTexture2D(&description, nullptr, &result->texture), "Create shared SDR texture");
  TextureLock ownership(result->texture.Get());
  ComPtr<IDXGISurface> surface;
  check(result->texture.As(&surface), "Get SDR surface");
  ComPtr<ID2D1Bitmap1> target;
  const auto target_properties = D2D1::BitmapProperties1(
      D2D1_BITMAP_OPTIONS_TARGET | D2D1_BITMAP_OPTIONS_CANNOT_DRAW,
      D2D1::PixelFormat(description.Format, D2D1_ALPHA_MODE_PREMULTIPLIED), 96, 96, state_->srgb.Get());
  check(context->CreateBitmapFromDxgiSurface(surface.Get(), &target_properties, &target), "Create SDR bitmap target");
  context->SetTarget(target.Get());
  context->SetTransform(D2D1::Matrix3x2F::Scale(float(width) / content_width, float(height) / content_height));
  context->BeginDraw();
  context->Clear(D2D1::ColorF(D2D1::ColorF::Black));
  const auto content = D2D1::RectF(0, 0, float(content_width), float(content_height));
  context->DrawImage(color.Get(), D2D1::Point2F(0, 0), content, D2D1_INTERPOLATION_MODE_LINEAR);
  const HRESULT draw_result = context->EndDraw();
  context->SetTarget(nullptr);
  context->SetTransform(D2D1::Matrix3x2F::Identity());
  check(draw_result, "Render SDR conversion");

  wait_for_gpu(state_->device.Get(), state_->immediate.Get());
  ComPtr<IDXGIResource1> shared;
  check(result->texture.As(&shared), "Get shared SDR resource");
  check(shared->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE,
      nullptr, &result->handle), "Create local NT texture handle");
  return result;
}

std::vector<uint8_t> SdrTextureConverter::readback(const std::shared_ptr<SdrTexture>& frame) {
  TextureLock ownership(frame->texture.Get());
  D3D11_TEXTURE2D_DESC description{};
  frame->texture->GetDesc(&description);
  description.Usage = D3D11_USAGE_STAGING;
  description.BindFlags = 0;
  description.MiscFlags = 0;
  description.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  ComPtr<ID3D11Texture2D> staging;
  check(state_->device->CreateTexture2D(&description, nullptr, &staging), "Create SDR readback");
  state_->immediate->CopyResource(staging.Get(), frame->texture.Get());
  D3D11_MAPPED_SUBRESOURCE mapped{};
  check(state_->immediate->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &mapped), "Read SDR pixels");
  std::vector<uint8_t> pixels(size_t(frame->width) * frame->height * 4);
  for (uint32_t row = 0; row < frame->height; ++row) {
    std::memcpy(pixels.data() + size_t(row) * frame->width * 4,
        static_cast<const uint8_t*>(mapped.pData) + size_t(row) * mapped.RowPitch, size_t(frame->width) * 4);
  }
  state_->immediate->Unmap(staging.Get(), 0);
  return pixels;
}
}
