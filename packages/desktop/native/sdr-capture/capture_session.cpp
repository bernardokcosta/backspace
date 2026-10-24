#include "capture_session.h"
#include "source_color.h"

#include <d3d11_4.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Metadata.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <utility>

using namespace winrt::Windows::Graphics;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
using Microsoft::WRL::ComPtr;

namespace backspace {
namespace {
struct Apartment {
  Apartment() { winrt::init_apartment(winrt::apartment_type::multi_threaded); }
  ~Apartment() { winrt::uninit_apartment(); }
};

struct Failure : std::runtime_error { using std::runtime_error::runtime_error; };

struct Wake {
  std::mutex mutex;
  std::condition_variable condition;
  bool arrived = false;
  bool closed = false;
  bool reconfigure = false;
};

struct CaptureResources {
  Direct3D11CaptureFramePool pool{nullptr};
  GraphicsCaptureSession session{nullptr};
  ~CaptureResources() {
    try { if (session) session.Close(); } catch (...) {}
    try { if (pool) pool.Close(); } catch (...) {}
  }
};

struct CheckedOutFrame {
  Direct3D11CaptureFrame frame{nullptr};
  ~CheckedOutFrame() { try { if (frame) frame.Close(); } catch (...) {} }
};

HMONITOR monitor_at(POINT origin) {
  struct Search { POINT origin; HMONITOR result = nullptr; bool ambiguous = false; } search{origin};
  const auto previous = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  const BOOL enumerated = EnumDisplayMonitors(nullptr, nullptr, [](HMONITOR monitor, HDC, LPRECT, LPARAM data) -> BOOL {
    auto& match = *reinterpret_cast<Search*>(data);
    MONITORINFO info{sizeof(MONITORINFO)};
    if (!GetMonitorInfoW(monitor, &info)) return FALSE;
    if (info.rcMonitor.left == match.origin.x && info.rcMonitor.top == match.origin.y) {
      if (match.result) match.ambiguous = true;
      match.result = monitor;
    }
    return TRUE;
  }, reinterpret_cast<LPARAM>(&search));
  if (previous) SetThreadDpiAwarenessContext(previous);
  if (!enumerated || !search.result || search.ambiguous) throw Failure("source-unavailable");
  return search.result;
}
}

CaptureSize captureOutputSize(uint32_t width, uint32_t height, const CaptureConstraints& constraints) {
  if (!width || !height || width > 16384 || height > 16384 || uint64_t(width) * height > 33554432
      || constraints.width > 16384 || constraints.height > 16384
      || uint64_t(constraints.width) * constraints.height > 33554432
      || (constraints.width == 0) != (constraints.height == 0)
      || !constraints.frame_rate || constraints.frame_rate > 240) throw std::invalid_argument("Invalid capture dimensions or rate");
  if (constraints.width == 0) return {width, height};
  const double ratio = std::min(double(constraints.width) / width, double(constraints.height) / height);
  return {std::max(1u, static_cast<uint32_t>(std::floor(width * ratio))),
      std::max(1u, static_cast<uint32_t>(std::floor(height * ratio)))};
}

struct CaptureSession::State {
  NativeCaptureSource source;
  CaptureConstraints constraints;
  std::mutex configuration_mutex;
  std::shared_ptr<CaptureFramePool> frames;
  FrameCallback on_frame;
  ErrorCallback on_error;
  std::shared_ptr<Wake> wake = std::make_shared<Wake>();
  std::jthread worker;

  void run(std::stop_token stop) noexcept {
    try {
      Apartment apartment;
      if (stop.stop_requested()) return;
      if (!GraphicsCaptureSession::IsSupported()) throw Failure("capture-unavailable");
      if (stop.stop_requested()) return;
      SdrTextureConverter converter;
      ComPtr<ID3D11DeviceContext> immediate;
      converter.device()->GetImmediateContext(&immediate);
      ComPtr<ID3D11Multithread> threading;
      winrt::check_hresult(immediate.As(&threading));
      threading->SetMultithreadProtected(TRUE);
      ComPtr<IDXGIDevice> dxgi;
      winrt::check_hresult(converter.device()->QueryInterface(IID_PPV_ARGS(&dxgi)));
      winrt::com_ptr<IInspectable> inspectable;
      winrt::check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.Get(), inspectable.put()));
      const auto device = inspectable.as<IDirect3DDevice>();
      if (stop.stop_requested()) return;
      auto interop = winrt::get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
      GraphicsCaptureItem item{nullptr};
      HMONITOR monitor = nullptr;
      if (source.window) {
        if (!IsWindow(source.window) || IsIconic(source.window)) throw Failure("source-unavailable");
        winrt::check_hresult(interop->CreateForWindow(source.window, winrt::guid_of<GraphicsCaptureItem>(), winrt::put_abi(item)));
      } else {
        monitor = monitor_at(*source.monitor_origin);
        winrt::check_hresult(interop->CreateForMonitor(monitor, winrt::guid_of<GraphicsCaptureItem>(), winrt::put_abi(item)));
      }
      SourceColorReader colors;
      auto size = item.Size();
      {
        std::lock_guard lock(configuration_mutex);
        captureOutputSize(static_cast<uint32_t>(size.Width), static_cast<uint32_t>(size.Height), constraints);
      }
      CaptureResources capture;
      if (stop.stop_requested()) return;
      capture.pool = Direct3D11CaptureFramePool::CreateFreeThreaded(device, DirectXPixelFormat::R16G16B16A16Float, 2, size);
      capture.session = capture.pool.CreateCaptureSession(item);
      if (winrt::Windows::Foundation::Metadata::ApiInformation::IsPropertyPresent(
          L"Windows.Graphics.Capture.GraphicsCaptureSession", L"IsCursorCaptureEnabled")) {
        capture.session.IsCursorCaptureEnabled(true);
      }
      const auto signals = wake;
      auto arrived = capture.pool.FrameArrived(winrt::auto_revoke, [signals](const auto&, const auto&) {
        { std::lock_guard lock(signals->mutex); signals->arrived = true; }
        signals->condition.notify_one();
      });
      auto closed = item.Closed(winrt::auto_revoke, [signals](const auto&, const auto&) {
        { std::lock_guard lock(signals->mutex); signals->closed = true; }
        signals->condition.notify_one();
      });
      if (stop.stop_requested()) return;
      capture.session.StartCapture();
      const auto started = std::chrono::steady_clock::now();
      auto last_output = started - std::chrono::seconds(1);
      bool received = false;
      while (!stop.stop_requested()) {
        bool reconfigure = false;
        {
          std::unique_lock lock(wake->mutex);
          wake->condition.wait_for(lock, std::chrono::milliseconds(100), [&] {
            return stop.stop_requested() || wake->arrived || wake->closed || wake->reconfigure;
          });
          if (stop.stop_requested()) break;
          if (wake->closed) throw Failure("source-closed");
          wake->arrived = false;
          reconfigure = std::exchange(wake->reconfigure, false);
        }
        // Some window providers stop sending frames without raising Closed.
        // The bounded wait still detects disappearance rather than hanging.
        if (source.window && !IsWindow(source.window)) throw Failure("source-closed");
        if (source.window && IsIconic(source.window)) throw Failure("source-unavailable");
        CaptureConstraints settings;
        { std::lock_guard lock(configuration_mutex); settings = constraints; }
        if (reconfigure) {
          capture.pool.Recreate(device, DirectXPixelFormat::R16G16B16A16Float, 2, size);
        }
        CheckedOutFrame current{capture.pool.TryGetNextFrame()};
        if (!current.frame) {
          if (!received && std::chrono::steady_clock::now() - started > std::chrono::seconds(10)) throw Failure("frame-timeout");
          continue;
        }
        received = true;
        // At most two WGC buffers exist; drop a superseded frame, never queue it.
        if (auto latest = capture.pool.TryGetNextFrame()) {
          current.frame.Close();
          current.frame = std::move(latest);
        }
        const auto content = current.frame.ContentSize();
        const auto output = captureOutputSize(static_cast<uint32_t>(content.Width), static_cast<uint32_t>(content.Height), settings);
        if (content.Width != size.Width || content.Height != size.Height) {
          current.frame.Close(); current.frame = nullptr;
          size = content;
          capture.pool.Recreate(device, DirectXPixelFormat::R16G16B16A16Float, 2, size);
          continue;
        }
        const auto now = std::chrono::steady_clock::now();
        if (now - last_output < std::chrono::microseconds(1000000 / settings.frame_rate)) continue;
        auto slot = frames->reserve();
        if (!slot) continue;
        CaptureColor color;
        try { color = source.window ? colors.window(source.window) : colors.monitor(monitor); }
        catch (const std::exception&) { throw Failure("source-color-unsupported"); }
        auto surface = current.frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
        ComPtr<ID3D11Texture2D> texture;
        winrt::check_hresult(surface->GetInterface(IID_PPV_ARGS(&texture)));
        const float measured = converter.measurePeakNits(texture.Get(), static_cast<uint32_t>(content.Width), static_cast<uint32_t>(content.Height));
        if (measured > 10000.0f) throw Failure("invalid-frame");
        const float peak = color.hdr ? std::max(color.white_nits, measured) : color.white_nits;
        auto converted = converter.convertTexture(texture.Get(), static_cast<uint32_t>(content.Width), static_cast<uint32_t>(content.Height),
            output.width, output.height, color.white_nits, peak);
        const auto timestamp = std::chrono::duration_cast<std::chrono::microseconds>(now.time_since_epoch()).count();
        const auto frame = slot->publish(std::move(converted), timestamp);
        try {
          if (stop.stop_requested() || !on_frame(frame)) frames->release(frame.id);
        } catch (...) { frames->release(frame.id); throw; }
        last_output = now;
      }
    } catch (const Failure& error) {
      report(stop, error.what());
    } catch (const winrt::hresult_error& error) {
      const auto code = error.code();
      report(stop, code == DXGI_ERROR_DEVICE_REMOVED || code == DXGI_ERROR_DEVICE_RESET || code == DXGI_ERROR_DEVICE_HUNG ? "device-lost" : "capture-failed");
    } catch (...) { report(stop, "capture-failed"); }
  }

  void report(std::stop_token stop, const std::string& code) noexcept {
    if (stop.stop_requested()) return;
    try { on_error(code); } catch (...) {}
  }
};

CaptureSession::CaptureSession(NativeCaptureSource source, CaptureConstraints constraints,
    std::shared_ptr<CaptureFramePool> frames, FrameCallback on_frame, ErrorCallback on_error) {
  captureOutputSize(1, 1, constraints);
  if ((source.window != nullptr) == source.monitor_origin.has_value() || !frames || !on_frame || !on_error) {
    throw std::invalid_argument("Invalid native capture source or callbacks");
  }
  if (source.window && (!IsWindow(source.window) || IsIconic(source.window))) throw std::invalid_argument("Native window source is unavailable");
  state_ = std::make_unique<State>();
  state_->source = source; state_->constraints = constraints; state_->frames = std::move(frames);
  state_->on_frame = std::move(on_frame); state_->on_error = std::move(on_error);
  state_->worker = std::jthread([state = state_.get()](std::stop_token stop) { state->run(stop); });
}

CaptureSession::~CaptureSession() { stop(); }

void CaptureSession::configure(CaptureConstraints constraints) {
  captureOutputSize(1, 1, constraints);
  { std::lock_guard lock(state_->configuration_mutex); state_->constraints = constraints; }
  { std::lock_guard lock(state_->wake->mutex); state_->wake->reconfigure = true; }
  state_->wake->condition.notify_one();
}

void CaptureSession::stop() {
  if (!state_ || !state_->worker.joinable()) return;
  state_->worker.request_stop();
  state_->wake->condition.notify_one();
  state_->worker.join();
}

bool CaptureSession::isSupported() {
  bool supported = false;
  std::thread probe([&supported] {
    try { Apartment apartment; supported = GraphicsCaptureSession::IsSupported(); } catch (...) {}
  });
  probe.join();
  return supported;
}
}
