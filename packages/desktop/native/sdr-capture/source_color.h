#pragma once

#include <windows.h>

#include <memory>

namespace backspace {
struct CaptureColor {
  bool hdr = false;
  float white_nits = 80.0f;
};

bool compatibleCaptureColor(const CaptureColor& left, const CaptureColor& right) noexcept;

/** Thread-owned metadata reader; does not acquire any screen pixels. */
class SourceColorReader {
 public:
  SourceColorReader();
  ~SourceColorReader();
  SourceColorReader(const SourceColorReader&) = delete;
  SourceColorReader& operator=(const SourceColorReader&) = delete;
  CaptureColor monitor(HMONITOR monitor);
  CaptureColor window(HWND window);
 private:
  struct State;
  std::unique_ptr<State> state_;
};
}
