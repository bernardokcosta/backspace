#pragma once

#include <d3d11.h>
#include <wrl/client.h>

#include <cstdint>
#include <memory>
#include <vector>

namespace backspace {
struct SdrTexture {
  Microsoft::WRL::ComPtr<ID3D11Texture2D> texture;
  HANDLE handle = nullptr;
  uint32_t width = 0;
  uint32_t height = 0;
  ~SdrTexture();
};

class SdrTextureConverter {
 public:
  SdrTextureConverter();
  ~SdrTextureConverter();
  SdrTextureConverter(const SdrTextureConverter&) = delete;
  SdrTextureConverter& operator=(const SdrTextureConverter&) = delete;
  std::shared_ptr<SdrTexture> create(const std::vector<float>& pixels, uint32_t width,
      uint32_t height, float white_nits, float max_nits);
  std::vector<uint8_t> readback(const std::shared_ptr<SdrTexture>& frame);

 private:
  struct State;
  std::unique_ptr<State> state_;
};
}
