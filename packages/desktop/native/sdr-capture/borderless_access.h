#pragma once

#include <chrono>
#include <condition_variable>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

namespace backspace {
enum class BorderlessAccessStatus {
  Allowed, DeniedUser, DeniedSystem, NotDeclared, Unsupported, Cancelled, Timeout, Failed
};
const char* borderlessAccessName(BorderlessAccessStatus status) noexcept;
/** Availability only; caller owns a WinRT apartment. Never requests consent. */
bool borderlessApisSupported();

/** Private OS seam. Operations and completions run on the permission worker. */
struct BorderlessOperation {
  virtual ~BorderlessOperation() = default;
  virtual std::optional<BorderlessAccessStatus> poll() = 0;
  virtual void cancel() noexcept = 0;
};

/** Entry points are serialized by the binding's main thread; callbacks must not reenter. */
class BorderlessAccess {
 public:
  using Completion = std::function<void(BorderlessAccessStatus)>;
  using Begin = std::function<std::unique_ptr<BorderlessOperation>()>;
  explicit BorderlessAccess(Begin begin = {},
      std::chrono::milliseconds timeout = std::chrono::seconds(60),
      std::chrono::milliseconds grant_lifetime = std::chrono::seconds(30));
  ~BorderlessAccess();
  bool request(const std::string& id, Completion complete);
  void cancel(const std::string& id);
  bool consume(const std::string& id);
  void stop();
 private:
  struct Request { Completion complete; std::chrono::steady_clock::time_point expires{}; };
  void run(std::stop_token stop) noexcept;
  void finish(BorderlessAccessStatus status) noexcept;
  Begin begin_;
  std::chrono::milliseconds timeout_;
  std::chrono::milliseconds grant_lifetime_;
  std::mutex mutex_;
  std::condition_variable changed_;
  std::map<std::string, Request> requests_;
  bool running_ = false;
  bool stopped_ = false;
  std::jthread worker_;
};
}
