#include "capture_binding.h"
#include "capture_session.h"

#include <atomic>
#include <charconv>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <utility>

namespace backspace {
namespace {
void check(napi_status status) {
  if (status != napi_ok) throw std::runtime_error("Native capture Node-API operation failed");
}

napi_value text(napi_env env, const std::string& value) {
  napi_value result;
  check(napi_create_string_utf8(env, value.c_str(), value.size(), &result));
  return result;
}

std::string read_text(napi_env env, napi_value value) {
  size_t length = 0;
  check(napi_get_value_string_utf8(env, value, nullptr, 0, &length));
  if (length == 0 || length > 64) throw std::invalid_argument("Invalid native capture identifier");
  std::string result(length + 1, '\0');
  check(napi_get_value_string_utf8(env, value, result.data(), result.size(), &length));
  result.resize(length);
  return result;
}

napi_value property(napi_env env, napi_value object, const char* key) {
  napi_value result;
  check(napi_get_named_property(env, object, key, &result));
  return result;
}

double read_integer(napi_env env, napi_value value, double minimum, double maximum) {
  double result = 0;
  check(napi_get_value_double(env, value, &result));
  if (!std::isfinite(result) || std::floor(result) != result || result < minimum || result > maximum) {
    throw std::invalid_argument("Invalid native capture integer");
  }
  return result;
}

CaptureConstraints read_constraints(napi_env env, napi_value object) {
  CaptureConstraints result;
  result.width = static_cast<uint32_t>(read_integer(env, property(env, object, "width"), 0, 16384));
  result.height = static_cast<uint32_t>(read_integer(env, property(env, object, "height"), 0, 16384));
  result.frame_rate = static_cast<uint32_t>(read_integer(env, property(env, object, "frameRate"), 1, 240));
  captureOutputSize(1, 1, result);
  return result;
}

NativeCaptureSource read_source(napi_env env, napi_value object) {
  const auto kind = read_text(env, property(env, object, "kind"));
  NativeCaptureSource result;
  if (kind == "window") {
    const auto id = read_text(env, property(env, object, "id"));
    const auto separator = id.find(':', 7);
    if (!id.starts_with("window:") || separator == std::string::npos || id.substr(separator) != ":0") {
      throw std::invalid_argument("Invalid native window source");
    }
    uintptr_t handle = 0;
    const auto parsed = std::from_chars(id.data() + 7, id.data() + separator, handle);
    if (parsed.ec != std::errc() || parsed.ptr != id.data() + separator || handle == 0) throw std::invalid_argument("Invalid native window source");
    result.window = reinterpret_cast<HWND>(handle);
  } else if (kind == "screen") {
    const auto origin = property(env, object, "nativeOrigin");
    result.monitor_origin = POINT{
      static_cast<LONG>(read_integer(env, property(env, origin, "x"), std::numeric_limits<LONG>::min(), std::numeric_limits<LONG>::max())),
      static_cast<LONG>(read_integer(env, property(env, origin, "y"), std::numeric_limits<LONG>::min(), std::numeric_limits<LONG>::max()))};
  } else throw std::invalid_argument("Invalid native capture source kind");
  return result;
}

void set_number(napi_env env, napi_value object, const char* name, double value) {
  napi_value number;
  check(napi_create_double(env, value, &number));
  check(napi_set_named_property(env, object, name, number));
}

napi_value frame_value(napi_env env, const CapturedSdrFrame& frame) {
  napi_value result;
  check(napi_create_object(env, &result));
  check(napi_set_named_property(env, result, "frameId", text(env, frame.id)));
  set_number(env, result, "width", frame.texture->width);
  set_number(env, result, "height", frame.texture->height);
  set_number(env, result, "timestampUs", static_cast<double>(frame.timestamp_us));
  napi_value handle;
  check(napi_create_buffer_copy(env, sizeof(frame.texture->handle), &frame.texture->handle, nullptr, &handle));
  check(napi_set_named_property(env, result, "ntHandle", handle));
  return result;
}

void clear_exception(napi_env env) noexcept {
  bool pending = false;
  if (napi_is_exception_pending(env, &pending) == napi_ok && pending) {
    napi_value exception;
    napi_get_and_clear_last_exception(env, &exception);
  }
}
}

struct NativeCaptureBinding::State {
  struct Event { CapturedSdrFrame frame; std::string error; };
  struct Delivery {
    State* owner;
    std::shared_ptr<CaptureFramePool> frames;
    napi_threadsafe_function function = nullptr;
    napi_ref on_error = nullptr;
    std::atomic<bool> active{true};
    std::atomic<bool> frame_pending{false};
  };
  napi_env env;
  std::shared_ptr<CaptureFramePool> frames;
  std::unique_ptr<CaptureSession> session;
  Delivery* delivery = nullptr; // Owned by the thread-safe function finalizer.
  std::string session_id;
  uint64_t next_id = 1;
  bool cleaned = false;

  void stop() {
    if (delivery) delivery->active = false;
    session.reset(); // Join before releasing the producer's TSFN reference.
    session_id.clear();
    if (delivery) {
      const auto function = delivery->function;
      delivery = nullptr;
      napi_release_threadsafe_function(function, napi_tsfn_abort);
    }
  }

  static void cleanup(void* data) {
    auto& owner = *static_cast<State*>(data);
    owner.cleaned = true;
    owner.stop();
  }

  static void finalize(napi_env env, void* data, void*) {
    auto context = std::unique_ptr<Delivery>(static_cast<Delivery*>(data));
    if (env && context->on_error) napi_delete_reference(env, context->on_error);
  }

  static void notify_error(napi_env env, Delivery& context, const std::string& reason) noexcept {
    try {
      napi_value callback;
      check(napi_get_reference_value(env, context.on_error, &callback));
      napi_value receiver;
      check(napi_get_undefined(env, &receiver));
      napi_value argument = text(env, reason);
      napi_value ignored;
      napi_call_function(env, receiver, callback, 1, &argument, &ignored);
    } catch (...) {}
    clear_exception(env);
  }

  static void deliver(napi_env env, napi_value callback, void* data, void* payload) {
    auto& context = *static_cast<Delivery*>(data);
    auto event = std::unique_ptr<Event>(static_cast<Event*>(payload));
    const bool has_frame = !event->frame.id.empty();
    if (has_frame) context.frame_pending = false;
    if (!env || !context.active) {
      if (has_frame) context.frames->release(event->frame.id);
      return;
    }
    if (!has_frame) {
      // Stop before notifying JS. A callback exception cannot leave capture on.
      context.owner->stop();
      notify_error(env, context, event->error);
      return;
    }
    bool called = false;
    try {
      const auto argument = frame_value(env, event->frame);
      napi_value receiver;
      check(napi_get_undefined(env, &receiver));
      napi_value ignored;
      called = true;
      check(napi_call_function(env, receiver, callback, 1, &argument, &ignored));
    } catch (...) {
      clear_exception(env);
      // Before invocation no import can exist. After invocation an import may
      // already own GPU references: only releaseFrame may retire that storage.
      if (!called) context.frames->release(event->frame.id);
      context.owner->stop();
      notify_error(env, context, "callback-failed");
    }
  }

  static State& arguments(napi_env env, napi_callback_info info, size_t& count, napi_value* args) {
    void* data = nullptr;
    check(napi_get_cb_info(env, info, &count, args, nullptr, &data));
    if (!data) throw std::runtime_error("Native capture binding is unavailable");
    return *static_cast<State*>(data);
  }

  static napi_value start(napi_env env, napi_callback_info info) {
    try {
      size_t count = 4;
      napi_value args[4];
      auto& owner = arguments(env, info, count, args);
      if (count != 4) throw std::invalid_argument("startCapture requires source, constraints and callbacks");
      if (owner.session) throw std::runtime_error("Native capture is already active");
      const auto source = read_source(env, args[0]);
      const auto constraints = read_constraints(env, args[1]);
      for (size_t i = 2; i < 4; ++i) {
        napi_valuetype type;
        check(napi_typeof(env, args[i], &type));
        if (type != napi_function) throw std::invalid_argument("Native capture callbacks must be functions");
      }
      const auto id = "sdr-" + std::to_string(owner.next_id++);
      const auto result = text(env, id);
      auto context = std::make_unique<Delivery>();
      context->owner = &owner; context->frames = owner.frames;
      check(napi_create_reference(env, args[3], 1, &context->on_error));
      const auto status = napi_create_threadsafe_function(env, args[2], nullptr, text(env, "Backspace SDR capture"),
          2, 1, context.get(), finalize, context.get(), deliver, &context->function);
      if (status != napi_ok) { napi_delete_reference(env, context->on_error); check(status); }
      auto* delivery = context.release();
      owner.delivery = delivery;
      try {
        owner.session_id = id;
        owner.session = std::make_unique<CaptureSession>(source, constraints, owner.frames,
            [delivery](const CapturedSdrFrame& frame) {
              if (!delivery->active || delivery->frame_pending.exchange(true)) return false;
              std::unique_ptr<Event> event;
              try { event = std::make_unique<Event>(Event{frame, {}}); }
              catch (...) { delivery->frame_pending = false; throw; }
              if (napi_call_threadsafe_function(delivery->function, event.get(), napi_tsfn_nonblocking) != napi_ok) {
                delivery->frame_pending = false;
                return false;
              }
              event.release();
              return true;
            }, [delivery](const std::string& reason) {
              if (!delivery->active) return;
              auto event = std::make_unique<Event>(Event{{}, reason});
              if (napi_call_threadsafe_function(delivery->function, event.get(), napi_tsfn_nonblocking) == napi_ok) event.release();
            });
      } catch (...) { owner.stop(); throw; }
      return result;
    } catch (const std::exception& error) { napi_throw_error(env, nullptr, error.what()); return nullptr; }
  }

  static napi_value configure(napi_env env, napi_callback_info info) {
    try {
      size_t count = 2;
      napi_value args[2];
      auto& owner = arguments(env, info, count, args);
      if (count != 2 || !owner.session || read_text(env, args[0]) != owner.session_id) throw std::invalid_argument("Native capture session is unavailable");
      owner.session->configure(read_constraints(env, args[1]));
      napi_value result;
      check(napi_get_undefined(env, &result));
      return result;
    } catch (const std::exception& error) { napi_throw_error(env, nullptr, error.what()); return nullptr; }
  }

  static napi_value stop_capture(napi_env env, napi_callback_info info) {
    try {
      size_t count = 1;
      napi_value args[1];
      auto& owner = arguments(env, info, count, args);
      if (count != 1) throw std::invalid_argument("stopCapture requires a session id");
      if (read_text(env, args[0]) == owner.session_id) owner.stop();
      napi_value result;
      check(napi_get_undefined(env, &result));
      return result;
    } catch (const std::exception& error) { napi_throw_error(env, nullptr, error.what()); return nullptr; }
  }

  static napi_value supported(napi_env env, napi_callback_info) {
    try {
      napi_value result;
      check(napi_get_boolean(env, CaptureSession::isSupported(), &result));
      return result;
    } catch (const std::exception& error) { napi_throw_error(env, nullptr, error.what()); return nullptr; }
  }
};

NativeCaptureBinding::NativeCaptureBinding(napi_env env, napi_value exports, std::shared_ptr<CaptureFramePool> frames)
    : state_(std::make_unique<State>()) {
  state_->env = env; state_->frames = std::move(frames);
  const napi_property_descriptor methods[] = {
    {"startCapture", nullptr, State::start, nullptr, nullptr, nullptr, napi_default, state_.get()},
    {"configureCapture", nullptr, State::configure, nullptr, nullptr, nullptr, napi_default, state_.get()},
    {"stopCapture", nullptr, State::stop_capture, nullptr, nullptr, nullptr, napi_default, state_.get()},
    {"isCaptureSupported", nullptr, State::supported, nullptr, nullptr, nullptr, napi_default, state_.get()},
  };
  check(napi_define_properties(env, exports, 4, methods));
  check(napi_add_env_cleanup_hook(env, State::cleanup, state_.get()));
}

NativeCaptureBinding::~NativeCaptureBinding() {
  if (!state_->cleaned) {
    napi_remove_env_cleanup_hook(state_->env, State::cleanup, state_.get());
    state_->stop();
  }
}
}
