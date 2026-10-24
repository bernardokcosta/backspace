#include "sdr_texture.h"

#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

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
    std::cout << "Native SDR texture tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
