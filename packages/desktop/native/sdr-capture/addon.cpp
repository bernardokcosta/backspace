#include <node_api.h>

#include "sdr_texture.h"
#include "capture_binding.h"
#include "frame_pool.h"

#include <chrono>
#include <cmath>
#include <memory>
#include <stdexcept>
#include <string>

namespace {
struct State {
  std::unique_ptr<backspace::SdrTextureConverter> converter;
  std::shared_ptr<backspace::CaptureFramePool> frames = std::make_shared<backspace::CaptureFramePool>();
  std::unique_ptr<backspace::NativeCaptureBinding> capture;
};

void check(napi_status status) {
  if (status != napi_ok) throw std::runtime_error("Native SDR Node-API operation failed");
}

State& state(napi_env env) {
  void* data = nullptr;
  check(napi_get_instance_data(env, &data));
  if (!data) throw std::runtime_error("Native SDR state is unavailable");
  return *static_cast<State*>(data);
}

napi_value number(napi_env env, double value) {
  napi_value result;
  check(napi_create_double(env, value, &result));
  return result;
}

napi_value text(napi_env env, const std::string& value) {
  napi_value result;
  check(napi_create_string_utf8(env, value.c_str(), value.size(), &result));
  return result;
}

double read_number(napi_env env, napi_value value) {
  double result = 0;
  check(napi_get_value_double(env, value, &result));
  if (!std::isfinite(result)) throw std::invalid_argument("Non-finite SDR parameter");
  return result;
}

std::string read_id(napi_env env, napi_value value) {
  size_t length = 0;
  check(napi_get_value_string_utf8(env, value, nullptr, 0, &length));
  if (!length || length > 64) throw std::invalid_argument("Invalid native SDR frame id");
  std::string result(length + 1, '\0');
  check(napi_get_value_string_utf8(env, value, result.data(), result.size(), &length));
  result.resize(length);
  return result;
}

void property(napi_env env, napi_value object, const char* name, napi_value value) {
  check(napi_set_named_property(env, object, name, value));
}

napi_value create_frame(napi_env env, napi_callback_info info) {
  State* current = nullptr;
  std::string id;
  try {
    size_t count = 5;
    napi_value args[5];
    check(napi_get_cb_info(env, info, &count, args, nullptr, nullptr));
    if (count != 5) throw std::invalid_argument("createTestFrame requires pixels, width, height, white nits and maximum nits");
    const double width = read_number(env, args[1]);
    const double height = read_number(env, args[2]);
    if (width < 1 || height < 1 || width > 16384 || height > 16384
        || std::floor(width) != width || std::floor(height) != height || width * height > 33554432) {
      throw std::invalid_argument("Invalid SDR dimensions");
    }
    napi_typedarray_type type;
    size_t length = 0;
    void* data = nullptr;
    napi_value array_buffer;
    size_t byte_offset = 0;
    check(napi_get_typedarray_info(env, args[0], &type, &length, &data, &array_buffer, &byte_offset));
    if (type != napi_float32_array || length != size_t(width * height * 4) || !data) {
      throw std::invalid_argument("Expected a complete Float32Array HDR image");
    }
    const auto white = static_cast<float>(read_number(env, args[3]));
    const auto maximum = static_cast<float>(read_number(env, args[4]));
    current = &state(env);
    auto slot = current->frames->reserve();
    if (!slot) throw std::runtime_error("Native SDR frame capacity exceeded");
    if (!current->converter) current->converter = std::make_unique<backspace::SdrTextureConverter>();
    const auto* begin = static_cast<const float*>(data);
    auto frame = current->converter->create(std::vector<float>(begin, begin + length),
        static_cast<uint32_t>(width), static_cast<uint32_t>(height), white, maximum);
    const auto timestamp = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    const auto retained = slot->publish(frame, timestamp);
    id = retained.id;
    napi_value result;
    check(napi_create_object(env, &result));
    property(env, result, "frameId", text(env, id));
    property(env, result, "width", number(env, width));
    property(env, result, "height", number(env, height));
    property(env, result, "timestampUs", number(env, static_cast<double>(timestamp)));
    napi_value handle;
    check(napi_create_buffer_copy(env, sizeof(frame->handle), &frame->handle, nullptr, &handle));
    property(env, result, "ntHandle", handle);
    return result;
  } catch (const std::exception& error) {
    if (current && !id.empty()) current->frames->release(id);
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
}

napi_value release_frame(napi_env env, napi_callback_info info) {
  try {
    size_t count = 1;
    napi_value argument;
    check(napi_get_cb_info(env, info, &count, &argument, nullptr, nullptr));
    if (count != 1) throw std::invalid_argument("releaseFrame requires one id");
    state(env).frames->release(read_id(env, argument));
    napi_value result;
    check(napi_get_undefined(env, &result));
    return result;
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
}

napi_value read_frame(napi_env env, napi_callback_info info) {
  try {
    size_t count = 1;
    napi_value argument;
    check(napi_get_cb_info(env, info, &count, &argument, nullptr, nullptr));
    if (count != 1) throw std::invalid_argument("readTestFrame requires one id");
    auto& current = state(env);
    const auto frame = current.frames->get(read_id(env, argument));
    if (!frame || !current.converter) throw std::invalid_argument("Native SDR test frame is not retained");
    const auto pixels = current.converter->readback(frame);
    napi_value result;
    check(napi_create_buffer_copy(env, pixels.size(), pixels.data(), nullptr, &result));
    return result;
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
}

napi_value retained_count(napi_env env, napi_callback_info) {
  try {
    return number(env, static_cast<double>(state(env).frames->retained()));
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
}

napi_value initialize(napi_env env, napi_value exports) {
  try {
    auto current = std::make_unique<State>();
    check(napi_set_instance_data(env, current.get(), [](napi_env, void* data, void*) { delete static_cast<State*>(data); }, nullptr));
    auto* owned = current.release();
    owned->capture = std::make_unique<backspace::NativeCaptureBinding>(env, exports, owned->frames);
    const napi_property_descriptor properties[] = {
      {"createTestFrame", nullptr, create_frame, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"releaseFrame", nullptr, release_frame, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"readTestFrame", nullptr, read_frame, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"retainedFrameCount", nullptr, retained_count, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    check(napi_define_properties(env, exports, 4, properties));
    return exports;
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
}
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
