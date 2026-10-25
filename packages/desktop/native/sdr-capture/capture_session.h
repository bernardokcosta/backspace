#pragma once

#include "frame_pool.h"

#include <functional>
#include <memory>
#include <optional>

namespace backspace {
struct CaptureConstraints {
  uint32_t width = 0;
  uint32_t height = 0;
  uint32_t frame_rate = 60;
};

struct CaptureSize { uint32_t width; uint32_t height; };
CaptureSize captureOutputSize(uint32_t width, uint32_t height, const CaptureConstraints& constraints);

/** Privileged mapping only: never deserialize these values from page IPC. */
struct NativeCaptureSource {
  HWND window = nullptr;
  std::optional<POINT> monitor_origin;
};

class CaptureSession {
 public:
  using FrameCallback = std::function<bool(const CapturedSdrFrame&)>;
  using ErrorCallback = std::function<void(const std::string&)>;
  CaptureSession(NativeCaptureSource source, CaptureConstraints constraints,
      std::shared_ptr<CaptureFramePool> frames, FrameCallback on_frame, ErrorCallback on_error,
      bool borderless_authorized = false);
  ~CaptureSession();
  CaptureSession(const CaptureSession&) = delete;
  CaptureSession& operator=(const CaptureSession&) = delete;
  void configure(CaptureConstraints constraints);
  void stop();
  static bool isSupported();
 private:
  struct State;
  std::unique_ptr<State> state_;
};
}
