#include "borderless_access.h"

#include <atomic>
#include <condition_variable>
#include <iostream>
#include <map>
#include <mutex>
#include <stdexcept>
#include <thread>

namespace {
using namespace backspace;
using namespace std::chrono_literals;
void require(bool valid, const char* message) { if (!valid) throw std::runtime_error(message); }
struct Control {
  std::atomic<int> result{-1};
  std::atomic<int> begins{0};
  std::atomic<int> cancels{0};
};
struct Operation final : BorderlessOperation {
  std::shared_ptr<Control> control;
  explicit Operation(std::shared_ptr<Control> value) : control(std::move(value)) { ++control->begins; }
  std::optional<BorderlessAccessStatus> poll() override {
    const auto value = control->result.load();
    return value < 0 ? std::nullopt : std::optional{static_cast<BorderlessAccessStatus>(value)};
  }
  void cancel() noexcept override { ++control->cancels; }
};
struct Results {
  std::mutex mutex;
  std::condition_variable changed;
  std::map<std::string, BorderlessAccessStatus> values;
  size_t calls = 0;
  auto callback(const std::string& id) {
    return [this, id](BorderlessAccessStatus result) {
      std::lock_guard lock(mutex);
      ++calls;
      require(!values.contains(id), "Permission request completed more than once");
      values[id] = result; changed.notify_all();
    };
  }
  BorderlessAccessStatus wait(const std::string& id) {
    std::unique_lock lock(mutex);
    require(changed.wait_for(lock, 2s, [&] { return values.contains(id); }), "Permission result timed out in the test");
    return values.at(id);
  }
};
}

void borderlessAccessTests() {
  for (const auto status : {BorderlessAccessStatus::Allowed, BorderlessAccessStatus::DeniedUser,
      BorderlessAccessStatus::DeniedSystem, BorderlessAccessStatus::NotDeclared,
      BorderlessAccessStatus::Unsupported, BorderlessAccessStatus::Failed}) {
    auto control = std::make_shared<Control>();
    control->result = static_cast<int>(status);
    Results results;
    BorderlessAccess access([control] { return std::make_unique<Operation>(control); });
    require(access.request("one", results.callback("one")), "First permission request refused");
    require(results.wait("one") == status, "OS access status was not preserved");
    require(access.consume("one") == (status == BorderlessAccessStatus::Allowed), "Non-allowed permission authorized capture");
    require(!access.consume("one"), "Permission preparation was reusable");
  }
  {
    auto control = std::make_shared<Control>(); Results results;
    BorderlessAccess access([control] { return std::make_unique<Operation>(control); });
    require(access.request("first", results.callback("first")), "First waiter refused");
    require(access.request("second", results.callback("second")), "Second waiter refused");
    require(!access.request("first", results.callback("duplicate")), "Duplicate request id accepted");
    access.cancel("first");
    require(results.wait("first") == BorderlessAccessStatus::Cancelled, "Cancelled waiter was not retired");
    control->result = static_cast<int>(BorderlessAccessStatus::Allowed);
    require(results.wait("second") == BorderlessAccessStatus::Allowed, "Cancellation discarded another waiter's request");
    require(control->begins == 1, "Waiters opened duplicate OS permission operations");
    require(!access.consume("first") && access.consume("second"), "Cancelled permission was used by capture");
    require(results.calls == 2, "Cancelled waiter received a late OS result");
  }
  {
    auto control = std::make_shared<Control>(); Results results;
    BorderlessAccess access([control] { return std::make_unique<Operation>(control); }, 20ms);
    access.request("timeout", results.callback("timeout"));
    require(results.wait("timeout") == BorderlessAccessStatus::Timeout, "Pending permission was not bounded");
    require(!access.consume("timeout"), "Timeout authorized capture");
  }
  {
    Results results;
    BorderlessAccess access([]() -> std::unique_ptr<BorderlessOperation> { throw std::runtime_error("OS failure"); });
    access.request("throw", results.callback("throw"));
    require(results.wait("throw") == BorderlessAccessStatus::Failed, "OS exception escaped permission handling");
  }
  {
    auto control = std::make_shared<Control>(); control->result = static_cast<int>(BorderlessAccessStatus::Allowed);
    Results results;
    BorderlessAccess access([control] { return std::make_unique<Operation>(control); }, 1s, 10ms);
    access.request("expired", results.callback("expired")); results.wait("expired");
    std::this_thread::sleep_for(30ms);
    require(!access.consume("expired"), "Expired preparation authorized capture");
  }
  {
    auto control = std::make_shared<Control>(); Results results;
    BorderlessAccess access([control] { return std::make_unique<Operation>(control); });
    for (int i = 0; i < 8; ++i) {
      const auto id = std::to_string(i);
      require(access.request(id, results.callback(id)), "Bounded waiter capacity too small");
    }
    require(!access.request("overflow", results.callback("overflow")), "Permission waiters were unbounded");
    const auto before = std::chrono::steady_clock::now(); access.stop();
    require(std::chrono::steady_clock::now() - before < 500ms, "Shutdown waited for unanswered permission UI");
    for (int i = 0; i < 8; ++i) require(results.wait(std::to_string(i)) == BorderlessAccessStatus::Cancelled, "Shutdown left a waiter active");
    control->result = static_cast<int>(BorderlessAccessStatus::Allowed);
    require(!access.consume("0"), "Late shutdown reply authorized capture");
  }
  std::cout << "Borderless permission lifecycle tests passed\n";
}
