#include "source_color.h"

#include <dxgi1_6.h>
#include <dwmapi.h>
#include <wrl/client.h>

#include <array>
#include <cmath>
#include <cwchar>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace backspace {
namespace {
class PhysicalCoordinates {
 public:
  PhysicalCoordinates() : previous_(SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) {}
  ~PhysicalCoordinates() { if (previous_) SetThreadDpiAwarenessContext(previous_); }
 private:
  DPI_AWARENESS_CONTEXT previous_;
};

void require(bool valid, const char* message) {
  if (!valid) throw std::runtime_error(message);
}

bool same_adapter(const LUID& left, const LUID& right) {
  return left.HighPart == right.HighPart && left.LowPart == right.LowPart;
}

struct MonitorList {
  std::array<HMONITOR, 16> monitors{};
  size_t count = 0;
  bool overflow = false;
};

BOOL CALLBACK collect_monitor(HMONITOR monitor, HDC, LPRECT, LPARAM context) {
  auto& list = *reinterpret_cast<MonitorList*>(context);
  if (list.count == list.monitors.size()) { list.overflow = true; return FALSE; }
  list.monitors[list.count++] = monitor;
  return TRUE;
}
}

struct SourceColorReader::State {
  struct Entry {
    ComPtr<IDXGIOutput6> output;
    std::wstring device_name;
    LUID adapter{};
  };
  ComPtr<IDXGIFactory1> factory;
  std::unordered_map<HMONITOR, Entry> entries;
};

bool compatibleCaptureColor(const CaptureColor& left, const CaptureColor& right) noexcept {
  return left.hdr == right.hdr && std::isfinite(left.white_nits) && std::isfinite(right.white_nits)
      && left.white_nits > 0 && right.white_nits > 0 && left.white_nits <= 10000 && right.white_nits <= 10000
      && std::abs(left.white_nits - right.white_nits) <= 0.5f;
}

SourceColorReader::SourceColorReader() : state_(std::make_unique<State>()) {}
SourceColorReader::~SourceColorReader() = default;

CaptureColor SourceColorReader::monitor(HMONITOR monitor_handle) {
  PhysicalCoordinates coordinates;
  MONITORINFOEXW info{};
  info.cbSize = sizeof(info);
  require(monitor_handle && GetMonitorInfoW(monitor_handle, reinterpret_cast<MONITORINFO*>(&info)), "Capture display is unavailable");
  if (state_->factory && !state_->factory->IsCurrent()) {
    state_->entries.clear();
    state_->factory.Reset();
  }
  auto found = state_->entries.find(monitor_handle);
  if (found != state_->entries.end() && found->second.device_name != info.szDevice) {
    state_->entries.erase(found);
    found = state_->entries.end();
  }
  if (found == state_->entries.end()) {
    if (state_->entries.size() >= 16) state_->entries.clear();
    if (!state_->factory) require(SUCCEEDED(CreateDXGIFactory1(IID_PPV_ARGS(&state_->factory))), "Display color interface is unavailable");
    State::Entry entry;
    entry.device_name = info.szDevice;
    for (UINT adapter_index = 0; !entry.output; ++adapter_index) {
      ComPtr<IDXGIAdapter1> adapter;
      const HRESULT adapter_status = state_->factory->EnumAdapters1(adapter_index, &adapter);
      if (adapter_status == DXGI_ERROR_NOT_FOUND) break;
      require(SUCCEEDED(adapter_status), "Enumerating display adapters failed");
      for (UINT output_index = 0; ; ++output_index) {
        ComPtr<IDXGIOutput> output;
        const HRESULT output_status = adapter->EnumOutputs(output_index, &output);
        if (output_status == DXGI_ERROR_NOT_FOUND) break;
        require(SUCCEEDED(output_status), "Enumerating display outputs failed");
        DXGI_OUTPUT_DESC description{};
        require(SUCCEEDED(output->GetDesc(&description)), "Reading display identity failed");
        if (description.Monitor != monitor_handle) continue;
        require(SUCCEEDED(output.As(&entry.output)), "Display does not expose reliable advanced color metadata");
        DXGI_ADAPTER_DESC1 adapter_description{};
        require(SUCCEEDED(adapter->GetDesc1(&adapter_description)), "Reading adapter identity failed");
        entry.adapter = adapter_description.AdapterLuid;
        break;
      }
    }
    require(bool(entry.output), "Selected display has no color metadata");
    found = state_->entries.emplace(monitor_handle, std::move(entry)).first;
  }
  auto& entry = found->second;
  DXGI_OUTPUT_DESC1 description{};
  require(SUCCEEDED(entry.output->GetDesc1(&description)) && description.Monitor == monitor_handle, "Capture display changed or was removed");
  const bool hdr = description.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020;
  if (!hdr) {
    require(description.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709
        || description.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P2020, "Unsupported desktop color space");
    return {false, 80.0f};
  }
  // Do not cache a successful topology forever: a later mirror/reattachment
  // can retain the same HMONITOR and GDI name but change the target identities.
  std::vector<DISPLAYCONFIG_PATH_INFO> paths;
  bool queried = false;
  for (int attempt = 0; attempt < 3; ++attempt) {
    UINT32 path_count = 0, mode_count = 0;
    require(GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &path_count, &mode_count) == ERROR_SUCCESS
        && path_count > 0 && path_count <= 128 && mode_count <= 1024, "Display topology is unavailable");
    paths.resize(path_count);
    std::vector<DISPLAYCONFIG_MODE_INFO> modes(mode_count);
    const LONG status = QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &path_count, paths.data(), &mode_count, modes.data(), nullptr);
    if (status == ERROR_INSUFFICIENT_BUFFER) continue;
    require(status == ERROR_SUCCESS, "Reading active display topology failed");
    paths.resize(path_count);
    queried = true;
    break;
  }
  require(queried, "Display topology kept changing");
  std::optional<UINT32> target_id;
  for (const auto& path : paths) {
    if (!same_adapter(entry.adapter, path.targetInfo.adapterId)) continue;
    DISPLAYCONFIG_SOURCE_DEVICE_NAME name{};
    name.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
    name.header.size = sizeof(name);
    name.header.adapterId = path.sourceInfo.adapterId;
    name.header.id = path.sourceInfo.id;
    if (DisplayConfigGetDeviceInfo(&name.header) != ERROR_SUCCESS || _wcsicmp(name.viewGdiDeviceName, entry.device_name.c_str()) != 0) continue;
    require(!target_id, "Mirrored HDR outputs have ambiguous source white levels");
    target_id = path.targetInfo.id;
  }
  require(target_id.has_value(), "HDR display white-level identity is unavailable");
  DISPLAYCONFIG_SDR_WHITE_LEVEL white{};
  white.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL;
  white.header.size = sizeof(white);
  white.header.adapterId = entry.adapter;
  white.header.id = *target_id;
  require(DisplayConfigGetDeviceInfo(&white.header) == ERROR_SUCCESS, "HDR display white level is unavailable");
  const float nits = float(white.SDRWhiteLevel) / 1000.0f * 80.0f;
  require(std::isfinite(nits) && nits > 0 && nits <= 10000, "HDR display white level is invalid");
  return {true, nits};
}

CaptureColor SourceColorReader::window(HWND window_handle) {
  PhysicalCoordinates coordinates;
  require(window_handle && IsWindow(window_handle) && !IsIconic(window_handle), "Capture window is unavailable or minimized");
  RECT bounds{};
  if (FAILED(DwmGetWindowAttribute(window_handle, DWMWA_EXTENDED_FRAME_BOUNDS, &bounds, sizeof(bounds)))) {
    require(GetWindowRect(window_handle, &bounds), "Capture window geometry is unavailable");
  }
  require(bounds.right > bounds.left && bounds.bottom > bounds.top, "Capture window has no visible geometry");
  MonitorList list;
  const BOOL enumerated = EnumDisplayMonitors(nullptr, &bounds, collect_monitor, reinterpret_cast<LPARAM>(&list));
  require(enumerated && !list.overflow && list.count > 0, "Capture window is offscreen or spans too many displays");
  const CaptureColor color = monitor(list.monitors[0]);
  for (size_t i = 1; i < list.count; ++i) {
    require(compatibleCaptureColor(color, monitor(list.monitors[i])), "Capture window spans incompatible display color modes");
  }
  return color;
}
}
