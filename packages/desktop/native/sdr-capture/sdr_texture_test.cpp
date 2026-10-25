#include "sdr_texture.h"
#include <DirectXPackedVector.h>

#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

void sourceColorPolicyTests();
void framePoolTests();
void captureSessionPolicyTests();

namespace {
void require(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}

std::vector<float> gray(const std::vector<float>& levels) {
  std::vector<float> pixels;
  for (const float value : levels) pixels.insert(pixels.end(), {value, value, value, 1.0f});
  return pixels;
}
}

int main() {
  try {
    sourceColorPolicyTests();
    framePoolTests();
    captureSessionPolicyTests();
    backspace::SdrTextureConverter converter;
    auto sdr = converter.create(gray({0.0f, 0.18f, 1.0f}), 3, 1, 80.0f, 80.0f);
    auto pixels = converter.readback(sdr);
    for (size_t i = 0; i < 3; ++i) {
      const int expected[] = {0, 118, 255};
      for (size_t c = 0; c < 3; ++c) require(std::abs(int(pixels[i * 4 + c]) - expected[i]) <= 2, "SDR reference conversion differs");
      require(pixels[i * 4 + 3] == 255, "Output is not opaque");
    }
    auto boosted = converter.create(gray({0.0f, 0.18f * 203.0f / 80.0f, 203.0f / 80.0f}), 3, 1, 203.0f, 203.0f);
    pixels = converter.readback(boosted);
    for (size_t i = 0; i < 3; ++i) {
      const int expected[] = {0, 118, 255};
      require(std::abs(int(pixels[i * 4]) - expected[i]) <= 2, "SDR desktop white normalization differs");
    }
    auto hdr = converter.create(gray({0.0f, 0.18f, 1.0f, 4.0f, 12.5f}), 5, 1, 203.0f, 1000.0f);
    pixels = converter.readback(hdr);
    for (size_t i = 1; i < 5; ++i) require(pixels[i * 4] > pixels[(i - 1) * 4], "HDR highlights clipped or out of order");
    for (size_t i = 0; i < 5; ++i) {
      require(std::abs(int(pixels[i * 4]) - int(pixels[i * 4 + 1])) <= 1, "Neutral green changed");
      require(std::abs(int(pixels[i * 4]) - int(pixels[i * 4 + 2])) <= 1, "Neutral red changed");
    }
    std::cout << "HDR neutral sRGB codes:";
    for (size_t i = 0; i < 5; ++i) std::cout << ' ' << int(pixels[i * 4]);
    std::cout << '\n';
    bool rejected = false;
    try { converter.create(gray({std::numeric_limits<float>::quiet_NaN()}), 1, 1, 80.0f, 80.0f); }
    catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "Non-finite input accepted");
    rejected = false;
    try { converter.create(gray({1.0f}), 1, 1, 0.0f, 1000.0f); }
    catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "Invalid white level accepted");
    auto negative = converter.create(gray({-1.0f, 0.0f, 1.0f}), 3, 1, 80.0f, 80.0f);
    pixels = converter.readback(negative);
    require(pixels[0] == 0 && pixels[4] == 0 && pixels[8] == 255, "Out-of-gamut SDR bounds differ");
    const auto linear = gray({0.0f, 0.18f, 1.0f});
    std::vector<DirectX::PackedVector::HALF> half(linear.size());
    for (size_t i = 0; i < linear.size(); ++i) half[i] = DirectX::PackedVector::XMConvertFloatToHalf(linear[i]);
    D3D11_TEXTURE2D_DESC source_description{};
    source_description.Width = 3; source_description.Height = 1;
    source_description.MipLevels = 1; source_description.ArraySize = 1;
    source_description.Format = DXGI_FORMAT_R16G16B16A16_FLOAT;
    source_description.SampleDesc.Count = 1;
    source_description.Usage = D3D11_USAGE_IMMUTABLE;
    source_description.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    const D3D11_SUBRESOURCE_DATA data{half.data(), 3 * 8, 0};
    Microsoft::WRL::ComPtr<ID3D11Texture2D> gpu_source;
    require(SUCCEEDED(converter.device()->CreateTexture2D(&source_description, &data, &gpu_source)), "Create GPU source fixture failed");
    require(std::abs(converter.measurePeakNits(gpu_source.Get(), 3, 1) - 80.0f) < 0.1f, "GPU source maximum luminance differs");
    require(std::abs(converter.measurePeakNits(gpu_source.Get(), 2, 1) - 14.4f) < 0.1f, "GPU peak inspected pixels beyond content bounds");
    auto converted = converter.convertTexture(gpu_source.Get(), 3, 1, 3, 1, 80.0f, 80.0f);
    pixels = converter.readback(converted);
    for (size_t i = 0; i < 3; ++i) {
      const int expected[] = {0, 118, 255};
      require(std::abs(int(pixels[i * 4]) - expected[i]) <= 2, "GPU source path differs from SDR reference");
    }
    auto scaled = converter.convertTexture(gpu_source.Get(), 3, 1, 6, 2, 80.0f, 80.0f);
    require(scaled->width == 6 && scaled->height == 2, "GPU source output geometry differs");
    rejected = false;
    try { converter.convertTexture(gpu_source.Get(), 4, 1, 4, 1, 80.0f, 80.0f); }
    catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "GPU source content outside the texture was accepted");
    for (size_t channel = 0; channel < 3; ++channel) half[8 + channel] = DirectX::PackedVector::XMConvertFloatToHalf(12.5f);
    Microsoft::WRL::ComPtr<ID3D11Texture2D> hdr_source;
    require(SUCCEEDED(converter.device()->CreateTexture2D(&source_description, &data, &hdr_source)), "Create HDR GPU source failed");
    require(std::abs(converter.measurePeakNits(hdr_source.Get(), 3, 1) - 1000.0f) < 0.1f, "HDR source peak was replaced by display metadata");
    source_description.Width = 33; source_description.Height = 17;
    std::vector<DirectX::PackedVector::HALF> tiled(33 * 17 * 4, 0);
    const size_t corner = (33 * 17 - 1) * 4;
    tiled[corner] = DirectX::PackedVector::XMConvertFloatToHalf(12.5f);
    D3D11_SUBRESOURCE_DATA tiled_data{tiled.data(), 33 * 8, 0};
    Microsoft::WRL::ComPtr<ID3D11Texture2D> tiled_source;
    require(SUCCEEDED(converter.device()->CreateTexture2D(&source_description, &tiled_data, &tiled_source)), "Create tiled GPU fixture failed");
    require(std::abs(converter.measurePeakNits(tiled_source.Get(), 33, 17) - 1000.0f) < 0.1f, "GPU peak failed across thread groups");
    require(converter.measurePeakNits(tiled_source.Get(), 32, 16) == 0.0f, "GPU peak read hidden source padding");
    tiled[corner] = 0x7e00; // FP16 quiet NaN from an invalid producer.
    Microsoft::WRL::ComPtr<ID3D11Texture2D> invalid_source;
    require(SUCCEEDED(converter.device()->CreateTexture2D(&source_description, &tiled_data, &invalid_source)), "Create invalid GPU fixture failed");
    rejected = false;
    try { converter.measurePeakNits(invalid_source.Get(), 33, 17); }
    catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "Non-finite captured GPU samples were accepted");
    std::cout << "Native SDR texture tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
