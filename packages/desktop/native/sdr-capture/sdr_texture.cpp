#include "sdr_texture.h"

#include <d2d1_1.h>
#include <d2d1effects.h>
#include <d2d1effects_2.h>
#include <dxgi1_2.h>
#include <DirectXPackedVector.h>

#include <chrono>
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
}

struct SdrTextureConverter::State {
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> immediate;
  ComPtr<ID2D1Factory1> factory;
  ComPtr<ID2D1Device> d2d_device;
  ComPtr<ID2D1DeviceContext> context;
  ComPtr<ID2D1ColorContext> linear;
  ComPtr<ID2D1ColorContext> srgb;
};

SdrTexture::~SdrTexture() {
  if (handle) CloseHandle(handle);
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

  auto& context = state_->context;
  ComPtr<ID2D1Bitmap1> input;
  const auto source_properties = D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_NONE,
      D2D1::PixelFormat(DXGI_FORMAT_R16G16B16A16_FLOAT, D2D1_ALPHA_MODE_IGNORE), 96, 96, state_->linear.Get());
  check(context->CreateBitmap(D2D1::SizeU(width, height), half.data(), width * 8,
      source_properties, &input), "Create FP16 source");
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
  context->BeginDraw();
  context->Clear(D2D1::ColorF(D2D1::ColorF::Black));
  context->DrawImage(color.Get(), D2D1::Point2F(0, 0), D2D1_INTERPOLATION_MODE_NEAREST_NEIGHBOR);
  const HRESULT draw_result = context->EndDraw();
  context->SetTarget(nullptr);
  check(draw_result, "Render SDR conversion");

  D3D11_QUERY_DESC query_description{D3D11_QUERY_EVENT, 0};
  ComPtr<ID3D11Query> completed;
  check(state_->device->CreateQuery(&query_description, &completed), "Create GPU completion query");
  state_->immediate->End(completed.Get());
  state_->immediate->Flush();
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
  for (;;) {
    const HRESULT status = state_->immediate->GetData(completed.Get(), nullptr, 0, 0);
    if (status == S_OK) break;
    check(status, "Wait for SDR GPU conversion");
    if (std::chrono::steady_clock::now() >= deadline) throw std::runtime_error("SDR GPU conversion timed out");
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
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
