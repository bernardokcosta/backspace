#include "borderless_access.h"

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Metadata.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Security.Authorization.AppCapabilityAccess.h>
#include <stdexcept>
#include <utility>
#include <array>

namespace backspace {
namespace {
struct Apartment {
  Apartment() { winrt::init_apartment(winrt::apartment_type::multi_threaded); }
  ~Apartment() { winrt::uninit_apartment(); }
};
class SystemOperation final : public BorderlessOperation {
  Apartment apartment_;
  winrt::Windows::Foundation::IAsyncOperation<winrt::Windows::Security::Authorization::AppCapabilityAccess::AppCapabilityAccessStatus> operation_{nullptr};
 public:
  SystemOperation() {
    if (borderlessApisSupported()) operation_ = winrt::Windows::Graphics::Capture::GraphicsCaptureAccess::RequestAccessAsync(
        winrt::Windows::Graphics::Capture::GraphicsCaptureAccessKind::Borderless);
  }
  std::optional<BorderlessAccessStatus> poll() override {
    using winrt::Windows::Foundation::AsyncStatus;
    using winrt::Windows::Security::Authorization::AppCapabilityAccess::AppCapabilityAccessStatus;
    if (!operation_) return BorderlessAccessStatus::Unsupported;
    const auto status = operation_.Status();
    if (status == AsyncStatus::Started) return std::nullopt;
    if (status == AsyncStatus::Canceled) return BorderlessAccessStatus::Cancelled;
    if (status == AsyncStatus::Error) return BorderlessAccessStatus::Failed;
    switch (operation_.GetResults()) {
      case AppCapabilityAccessStatus::Allowed: return BorderlessAccessStatus::Allowed;
      case AppCapabilityAccessStatus::DeniedByUser: return BorderlessAccessStatus::DeniedUser;
      case AppCapabilityAccessStatus::DeniedBySystem: return BorderlessAccessStatus::DeniedSystem;
      case AppCapabilityAccessStatus::NotDeclaredByApp: return BorderlessAccessStatus::NotDeclared;
      default: return BorderlessAccessStatus::Failed;
    }
  }
  void cancel() noexcept override { try { if (operation_) operation_.Cancel(); } catch (...) {} }
};
void notify(const BorderlessAccess::Completion& callback, BorderlessAccessStatus status) noexcept {
  try { if (callback) callback(status); } catch (...) { /* A caller cannot retain the OS worker by throwing. */ }
}
}

bool borderlessApisSupported() {
  using winrt::Windows::Foundation::Metadata::ApiInformation;
  return ApiInformation::IsTypePresent(L"Windows.Graphics.Capture.GraphicsCaptureAccess")
      && ApiInformation::IsPropertyPresent(L"Windows.Graphics.Capture.GraphicsCaptureSession", L"IsBorderRequired");
}

const char* borderlessAccessName(BorderlessAccessStatus status) noexcept {
  switch (status) {
    case BorderlessAccessStatus::Allowed: return "allowed";
    case BorderlessAccessStatus::DeniedUser: return "denied-user";
    case BorderlessAccessStatus::DeniedSystem: return "denied-system";
    case BorderlessAccessStatus::NotDeclared: return "not-declared";
    case BorderlessAccessStatus::Unsupported: return "unsupported";
    case BorderlessAccessStatus::Cancelled: return "cancelled";
    case BorderlessAccessStatus::Timeout: return "timeout";
    default: return "failed";
  }
}

BorderlessAccess::BorderlessAccess(Begin begin, std::chrono::milliseconds timeout, std::chrono::milliseconds grant_lifetime)
    : begin_(begin ? std::move(begin) : [] { return std::make_unique<SystemOperation>(); }),
      timeout_(timeout), grant_lifetime_(grant_lifetime) {
  if (timeout.count() <= 0 || grant_lifetime.count() <= 0) throw std::invalid_argument("Invalid borderless permission deadlines");
}
BorderlessAccess::~BorderlessAccess() { stop(); }

bool BorderlessAccess::request(const std::string& id, Completion complete) {
  if (id.empty() || id.size() > 64 || !complete) return false;
  bool join;
  {
    std::lock_guard lock(mutex_);
    if (stopped_) return false;
    join = !running_ || worker_.get_stop_token().stop_requested();
  }
  // The OS operation is polled, never synchronously awaited. Joining a retired
  // worker cannot wait for user input; it observes stop at the next wake.
  if (join && worker_.joinable()) worker_.join();
  bool start;
  {
    std::lock_guard lock(mutex_);
    const auto now = std::chrono::steady_clock::now();
    std::erase_if(requests_, [now](const auto& entry) { return !entry.second.complete && entry.second.expires <= now; });
    if (requests_.contains(id) || requests_.size() >= 8) return false;
    requests_.emplace(id, Request{std::move(complete), {}});
    start = !running_;
    if (start) running_ = true;
  }
  if (start) {
    try { worker_ = std::jthread([this](std::stop_token stop) { run(stop); }); }
    catch (...) { finish(BorderlessAccessStatus::Failed); }
  }
  return true;
}

void BorderlessAccess::run(std::stop_token stop) noexcept {
  auto status = BorderlessAccessStatus::Cancelled;
  std::unique_ptr<BorderlessOperation> operation;
  try {
    if (!stop.stop_requested()) {
      operation = begin_();
      if (!operation) throw std::runtime_error("Missing OS permission operation");
      const auto deadline = std::chrono::steady_clock::now() + timeout_;
      while (!stop.stop_requested()) {
        if (const auto answer = operation->poll()) { status = *answer; break; }
        if (std::chrono::steady_clock::now() >= deadline) { status = BorderlessAccessStatus::Timeout; break; }
        std::unique_lock lock(mutex_);
        changed_.wait_for(lock, std::chrono::milliseconds(10), [&] { return stop.stop_requested(); });
      }
    }
  } catch (...) { status = BorderlessAccessStatus::Failed; }
  if (stop.stop_requested()) status = BorderlessAccessStatus::Cancelled;
  if (operation && (status == BorderlessAccessStatus::Cancelled || status == BorderlessAccessStatus::Timeout)) operation->cancel();
  operation.reset(); // Release WinRT references before their apartment/thread ends.
  finish(status);
}

void BorderlessAccess::finish(BorderlessAccessStatus status) noexcept {
  std::array<Completion, 8> callbacks;
  size_t count = 0;
  {
    std::lock_guard lock(mutex_);
    const auto expires = std::chrono::steady_clock::now() + grant_lifetime_;
    for (auto iterator = requests_.begin(); iterator != requests_.end();) {
      auto& request = iterator->second;
      if (!request.complete) { ++iterator; continue; }
      callbacks[count++] = std::move(request.complete);
      if (status == BorderlessAccessStatus::Allowed && !stopped_) { request.expires = expires; ++iterator; }
      else iterator = requests_.erase(iterator);
    }
    running_ = false;
  }
  for (const auto& callback : callbacks) notify(callback, status);
}

void BorderlessAccess::cancel(const std::string& id) {
  Completion callback;
  bool pending = false;
  {
    std::lock_guard lock(mutex_);
    if (const auto found = requests_.find(id); found != requests_.end()) {
      callback = std::move(found->second.complete); requests_.erase(found);
    }
    for (const auto& entry : requests_) if (entry.second.complete) pending = true;
  }
  if (!pending) { worker_.request_stop(); changed_.notify_all(); }
  notify(callback, BorderlessAccessStatus::Cancelled);
}

bool BorderlessAccess::consume(const std::string& id) {
  std::lock_guard lock(mutex_);
  const auto found = requests_.find(id);
  if (found == requests_.end() || found->second.complete) return false;
  const bool allowed = !stopped_ && found->second.expires > std::chrono::steady_clock::now();
  requests_.erase(found);
  return allowed;
}

void BorderlessAccess::stop() {
  std::array<Completion, 8> callbacks;
  size_t count = 0;
  {
    std::lock_guard lock(mutex_);
    stopped_ = true;
    for (auto& entry : requests_) if (entry.second.complete) callbacks[count++] = std::move(entry.second.complete);
    requests_.clear();
  }
  worker_.request_stop(); changed_.notify_all();
  if (worker_.joinable()) worker_.join();
  for (const auto& callback : callbacks) notify(callback, BorderlessAccessStatus::Cancelled);
}
}
