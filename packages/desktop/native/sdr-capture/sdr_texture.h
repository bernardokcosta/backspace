#pragma once

#include <d3d11.h>
#include <wrl/client.h>

#include <cstdint>
#include <memory>
#include <vector>

struct ID2D1Bitmap1;

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
  ID3D11Device* device() const noexcept;
  float measurePeakNits(ID3D11Texture2D* source, uint32_t content_width, uint32_t content_height);
  std::shared_ptr<SdrTexture> convertTexture(ID3D11Texture2D* source,
      uint32_t content_width, uint32_t content_height, uint32_t output_width,
      uint32_t output_height, float white_nits, float max_nits);
  std::vector<uint8_t> readback(const std::shared_ptr<SdrTexture>& frame);

 private:
  struct State;
  std::unique_ptr<State> state_;
  std::shared_ptr<SdrTexture> render(ID2D1Bitmap1* input, uint32_t content_width,
      uint32_t content_height, uint32_t output_width, uint32_t output_height,
      float white_nits, float max_nits);
};
}
