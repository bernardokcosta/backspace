#include "frame_pool.h"

#include <limits>
#include <atomic>
#include <mutex>
#include <stdexcept>
#include <unordered_map>
#include <utility>

namespace backspace {
namespace {
struct Capacity {
  std::atomic<size_t> live{0};
};
struct Permit {
  explicit Permit(std::shared_ptr<Capacity> counter) : counter(std::move(counter)) { ++this->counter->live; }
  ~Permit() { --counter->live; }
  std::shared_ptr<Capacity> counter;
};
}

struct CaptureFramePool::Core {
  mutable std::mutex mutex;
  std::unordered_map<std::string, std::shared_ptr<SdrTexture>> frames;
  uint64_t next_id = 1;
  std::shared_ptr<Capacity> capacity = std::make_shared<Capacity>();
};

CaptureFramePool::CaptureFramePool() : core_(std::make_shared<Core>()) {}

CaptureFramePool::Reservation::Reservation(std::shared_ptr<Core> core, std::string id, std::shared_ptr<void> capacity) noexcept
    : core_(std::move(core)), id_(std::move(id)), capacity_(std::move(capacity)) {}

CaptureFramePool::Reservation::Reservation(Reservation&& other) noexcept
    : core_(std::move(other.core_)), id_(std::move(other.id_)), capacity_(std::move(other.capacity_)), published_(other.published_) {}

CaptureFramePool::Reservation::~Reservation() {
  if (!core_ || published_) return;
  std::lock_guard lock(core_->mutex);
  core_->frames.erase(id_);
}

CapturedSdrFrame CaptureFramePool::Reservation::publish(std::shared_ptr<SdrTexture> texture, int64_t timestamp_us) {
  if (!core_ || published_ || !texture || texture->pool_capacity || timestamp_us < 0) throw std::invalid_argument("Invalid native frame publication");
  CapturedSdrFrame result{id_, texture, timestamp_us};
  std::lock_guard lock(core_->mutex);
  texture->pool_capacity = capacity_;
  core_->frames.at(id_) = std::move(texture);
  published_ = true;
  return result;
}

std::optional<CaptureFramePool::Reservation> CaptureFramePool::reserve() {
  std::lock_guard lock(core_->mutex);
  if (core_->capacity->live >= 3) return std::nullopt;
  if (core_->next_id == std::numeric_limits<uint64_t>::max()) throw std::runtime_error("Native frame identity exhausted");
  std::string id = std::to_string(core_->next_id++);
  auto capacity = std::make_shared<Permit>(core_->capacity);
  core_->frames.emplace(id, nullptr);
  return Reservation(core_, std::move(id), std::move(capacity));
}

void CaptureFramePool::release(const std::string& id) {
  std::lock_guard lock(core_->mutex);
  core_->frames.erase(id);
}

std::shared_ptr<SdrTexture> CaptureFramePool::get(const std::string& id) const {
  std::lock_guard lock(core_->mutex);
  const auto found = core_->frames.find(id);
  return found == core_->frames.end() ? nullptr : found->second;
}

size_t CaptureFramePool::retained() const {
  return core_->capacity->live;
}
}
