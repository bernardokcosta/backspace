#include "frame_pool.h"

#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>

void framePoolTests() {
  auto require = [](bool valid, const char* message) { if (!valid) throw std::runtime_error(message); };
  backspace::CaptureFramePool pool;
  {
    auto first = pool.reserve();
    auto second = pool.reserve();
    auto third = pool.reserve();
    require(first && second && third && !pool.reserve(), "Native reservations exceeded three slots");
    require(pool.retained() == 3, "Reservations were not counted before allocation");
  }
  require(pool.retained() == 0, "Abandoned reservations were not released");
  {
    std::vector<std::shared_ptr<backspace::SdrTexture>> callbacks;
    for (size_t i = 0; i < 3; ++i) {
      auto slot = pool.reserve();
      const auto frame = slot->publish(std::make_shared<backspace::SdrTexture>(), 0);
      callbacks.push_back(frame.texture);
      pool.release(frame.id);
    }
    require(!pool.reserve(), "A callback-held texture outlived its capacity reservation");
    callbacks.clear();
  }
  require(pool.retained() == 0, "Callback-held texture capacity was not released");
  std::vector<std::string> retired;
  for (size_t i = 0; i < 3; ++i) {
    auto slot = pool.reserve();
    const auto frame = slot->publish(std::make_shared<backspace::SdrTexture>(), int64_t(i));
    retired.push_back(frame.id);
  }
  for (size_t i = 0; i < 100; ++i) require(!pool.reserve(), "Restart reused an old held slot");
  require(pool.retained() == 3, "Retired frames were not retained across restarts");
  pool.release(retired[0]);
  pool.release(retired[0]);
  require(pool.retained() == 2, "Frame release was not idempotent");
  {
    auto replacement = pool.reserve();
    require(replacement.has_value(), "Released slot was unavailable");
    const auto frame = replacement->publish(std::make_shared<backspace::SdrTexture>(), 100);
    require(frame.id != retired[0], "Frame identity was recycled");
    pool.release(frame.id);
  }
  for (const auto& id : retired) pool.release(id);
  std::vector<std::thread> workers;
  for (size_t i = 0; i < 8; ++i) {
    workers.emplace_back([&pool] {
      for (size_t attempt = 0; attempt < 100; ++attempt) {
        auto slot = pool.reserve();
        if (!slot) continue;
        const auto frame = slot->publish(std::make_shared<backspace::SdrTexture>(), 1);
        pool.release(frame.id);
      }
    });
  }
  for (auto& worker : workers) worker.join();
  require(pool.retained() == 0, "Concurrent native producers leaked a slot");
  std::cout << "Native frame reservation tests passed\n";
}
