# Spec: Windows SDR capture

**Module id:** `windows-sdr-capture`
**Status:** Specification and plan approved by the user; inline implementation in progress
**Initiative:** [Desktop 1.15.1](2026-10-24-desktop-1.15.1-design.md)

The initiative defines shared commands, style, dependencies and boundaries.

## Objective

Let a Windows desktop user share an HDR display without washed-out or clipped
highlights, like OBS's Force SDR capture option. The monitor stays in HDR;
only this screen-share video's output becomes SDR. Viewers need no special
desktop version or HDR display to receive that SDR video.

## Chosen approach and rejected alternatives

Use native Windows Graphics Capture to acquire HDR-capable frames before
information is lost, then convert them to a correctly tagged SDR output before
the setup preview and LiveKit publication. Use the existing capture and audio
lifecycle where possible; native capture is a private implementation behind a
small desktop capability/start/stop interface.

Rejected as equivalent fixes:

- Changing Electron's window color profile does not establish conversion of
  another application's captured HDR content.
- Adjusting brightness/gamma on an already clipped 8-bit frame cannot restore
  the lost highlights.
- Forcing an old Chromium WGC feature flag is not a supported per-capture SDR
  option in the pinned Chromium source. Do not depend on an obsolete flag.
- Turning off the user's monitor HDR changes unrelated applications and is not
  the requested feature.

## Behavior and interface contract

1. Add a saved boolean Force SDR preference to screen-share settings, default
   off for existing and new configurations. It must be visible in the existing
   quality controls, not an unrelated global appearance preference.
2. Capability is measured by the desktop host: supported Windows/graphics
   capture APIs, loadable native module and usable frame transport. Unsupported
   platforms retain their current capture behavior and do not offer a working
   toggle that silently does nothing.
3. The preference is applied when acquiring a new capture. While a capture is
   active, explain that it must be stopped/restarted to change this setting;
   do not display a changed preference as an already-changed live output.
4. Source choice stays explicit. Only the main window's authorized capture
   flow may start native capture of its selected source. Reject unselected,
   stale or vanished sources, foreign senders and arbitrary source/handle
   injection. Preserve existing focus and enumeration policy.
5. Acquire a high-precision HDR-capable source, with correct source color and
   per-display SDR-white information. Convert to bounded SDR with correct
   transfer function, gamut and metadata. Preserve ordinary SDR whites and
   neutral grays instead of universally darkening every source.
6. The setup preview uses the actual SDR video track that will be published.
   Cancelling setup must never send frames to the room. The raw overexposed
   capture must not be accidentally published as the corrected one.
7. Keep existing user-selected resolution, aspect ratio, frame rate, codec,
   bitrate, system-audio preference and own-audio exclusion semantics. Reuse
   the current audio track; native video must not start a second microphone or
   publish duplicate audio.
8. Keep native pointers, process handles, native module loading and file paths
   inside privileged code. A remote instance's renderer receives only its
   authorized frames/stream and bounded status information. Preserve
   `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` and the
   three security fuses' existing states.
9. Bound work in flight and drop superseded frames rather than queueing
   unlimited captures. Do not recycle a texture while Chromium/GPU still uses
   it. Use monotonic timestamps. All error/cancel/close/navigation/unpublish
   paths stop native capture and release frames, handles and subscriptions.
10. Source closure, resize, display removal, GPU/device loss and transport
    failure produce a visible, recoverable result. Force SDR must not silently
    fall back to an uncorrected stream while claiming to be enabled. The user
    can explicitly disable it and retry ordinary capture.
11. Windows installers include the matching native binary for **x64 and
    arm64**. macOS/Linux do not load or build that Windows module.

## Technical feasibility gate

Before building the complete feature, prove one authorized native capture can
reach the sandboxed renderer as a playable video track with deterministic
cleanup on the pinned Electron version. Electron's experimental `sharedTexture`
interface is a candidate GPU transport, not a validated implementation yet.
Its lifetime and sandbox availability must be checked rather than assumed.
Do not relax security to make a prototype pass. If no acceptable transport is
available, report the blocker before release or enforcement.

## Tests and success criteria

- Configs without the new field remain valid and Force SDR stays off.
- Unsupported/older hosts produce truthful UI and preserve ordinary capture.
- Deterministic native reference tests exercise black, SDR reference white,
  neutral grays, highlights above SDR white, gamut limits and non-finite input.
- Both packaged Windows architectures load the correct native binary.
- Cancelling before publish, ending a share, navigation, renderer loss and
  device errors release every resource, with bounded in-flight frame counts.
- A real HDR capture comparison, received on an SDR display, shows readable
  highlight detail and neutral colors with Windows HDR still enabled.
- Preview and received video agree; ordinary SDR sources remain usable;
  selected quality and audio behavior remain correct.
- Record sustained capture performance and memory/handle behavior at 1080p60
  and a high-resolution mode supported by the test hardware. Do not infer
  4K/high-refresh support from a small static-image test.

## Sources and limits of evidence

- [Electron 45 sharedTexture interface](https://github.com/electron/electron/blob/v45.0.0/docs/api/shared-texture.md)
- [Shared texture lifetime and NT-handle requirements](https://github.com/electron/electron/blob/v45.0.0/shell/common/api/shared_texture/README.md)
- [Chromium 156 desktop capture selection](https://github.com/chromium/chromium/blob/156.0.8078.48/content/browser/media/capture/desktop_capture_device.cc)
- [OBS Force SDR behavior/motivation](https://github.com/obsproject/obs-studio/pull/7974)

These explain the design choice; they are not evidence that Backspace's native
module, sandbox transport or HDR conversion has already been implemented or
tested. Do not import OBS code or another incompatible dependency.
