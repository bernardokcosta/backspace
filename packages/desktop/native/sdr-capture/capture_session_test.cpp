#include "capture_session.h"

#include <iostream>
#include <stdexcept>

void captureSessionPolicyTests() {
  auto require = [](bool valid, const char* message) { if (!valid) throw std::runtime_error(message); };
  auto size = backspace::captureOutputSize(3840, 2160, {1920, 1080, 60});
  require(size.width == 1920 && size.height == 1080, "Requested capture dimensions differ");
  size = backspace::captureOutputSize(156, 78, {90, 45, 60});
  require(size.width == 90 && size.height == 45, "Floating-point scaling lost a pixel at an exact aspect ratio");
  size = backspace::captureOutputSize(1920, 1080, {640, 480, 60});
  require(size.width == 640 && size.height == 360, "Capture did not preserve source aspect ratio");
  size = backspace::captureOutputSize(3439, 1440, {0, 0, 60});
  require(size.width == 3439 && size.height == 1440, "Source-native capture geometry changed");
  for (const auto constraints : {backspace::CaptureConstraints{0, 720, 60}, {1920, 1080, 0}, {1920, 1080, 241}, {10000, 10000, 60}}) {
    bool rejected = false;
    try { backspace::captureOutputSize(1920, 1080, constraints); }
    catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "Invalid native capture constraints accepted");
  }
  bool rejected = false;
  try { backspace::captureOutputSize(0, 1080, {0, 0, 60}); }
  catch (const std::invalid_argument&) { rejected = true; }
  require(rejected, "Empty capture frame accepted");
  rejected = false;
  try {
    backspace::CaptureSession session({}, {0, 0, 60}, std::make_shared<backspace::CaptureFramePool>(),
        [](const backspace::CapturedSdrFrame&) { return true; }, [](const std::string&) {});
  } catch (const std::invalid_argument&) { rejected = true; }
  require(rejected, "Missing native capture source accepted");
  std::cout << "Native capture session policy tests passed\n";
}
