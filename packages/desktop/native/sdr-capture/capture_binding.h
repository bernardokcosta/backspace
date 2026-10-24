#pragma once

#include <node_api.h>
#include "frame_pool.h"

#include <memory>

namespace backspace {
/** Node-API worker delivery; all source values are supplied by trusted main. */
class NativeCaptureBinding {
 public:
  NativeCaptureBinding(napi_env env, napi_value exports, std::shared_ptr<CaptureFramePool> frames);
  ~NativeCaptureBinding();
  NativeCaptureBinding(const NativeCaptureBinding&) = delete;
  NativeCaptureBinding& operator=(const NativeCaptureBinding&) = delete;
 private:
  struct State;
  std::unique_ptr<State> state_;
};
}
