#pragma once

#include "sdr_texture.h"

#include <memory>
#include <optional>
#include <string>

namespace backspace {
struct CapturedSdrFrame {
  std::string id;
  std::shared_ptr<SdrTexture> texture;
  int64_t timestamp_us = 0;
};

/** Reserves capacity before GPU allocation, including queued/retired sessions. */
class CaptureFramePool {
  struct Core;
 public:
  class Reservation {
   public:
    ~Reservation();
    Reservation(Reservation&& other) noexcept;
    Reservation& operator=(Reservation&&) = delete;
    Reservation(const Reservation&) = delete;
    Reservation& operator=(const Reservation&) = delete;
    CapturedSdrFrame publish(std::shared_ptr<SdrTexture> texture, int64_t timestamp_us);
   private:
    friend class CaptureFramePool;
    Reservation(std::shared_ptr<Core> core, std::string id, std::shared_ptr<void> capacity) noexcept;
    std::shared_ptr<Core> core_;
    std::string id_;
    std::shared_ptr<void> capacity_;
    bool published_ = false;
  };

  CaptureFramePool();
  std::optional<Reservation> reserve();
  void release(const std::string& id);
  std::shared_ptr<SdrTexture> get(const std::string& id) const;
  size_t retained() const;
 private:
  std::shared_ptr<Core> core_;
};
}
