# Veyvox Flatpak packaging

The current checkout builds Veyvox for x86_64 and aarch64 using the Electron
BaseApp and the generated CI manifest below. All pnpm packages, Electron binaries, and
native dependency archives are declared in `node-sources.json`, so compilation
runs without network access. Flatpak, rather than Electron's built-in updater,
owns upgrades of this installation.

## Build and install locally

The root manifest and committed `flatpak/node-sources.json` retain their
historical upstream release pin as a matching pair; they are not a published
Veyvox 1.17.0 Flatpak. Do not mix that old source pin with the current fork's build
files. To build **this checkout**, generate its offline source list and CI
manifest. Install Flatpak Builder and the pinned Node SDK extension first:

```sh
flatpak remote-add --user --if-not-exists flathub \
  https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.flatpak.Builder \
  org.freedesktop.Sdk.Extension.node24//25.08
```

Run these commands again after changing `pnpm-lock.yaml`. Generation needs
network access; the subsequent compilation runs offline. The generated manifest
uses the current directory and `flatpak/node-sources.ci.json`; both generated
files are ignored by Git.

`prepare-ci-manifest.mjs` checks that the generated source list exists before
writing or replacing the CI manifest. If it is missing, the error includes the
generator command below. Source paths resolve relative to the output manifest's
directory, not the current working directory, and the generated manifest builds
`.` as its application source, so write the CI manifest at the checkout root.

```sh
flatpak run --filesystem="$PWD" --command=flatpak-node-generator \
  org.flatpak.Builder \
  --electron-node-headers \
  --node-sdk-extension org.freedesktop.Sdk.Extension.node24//25.08 \
  -o "$PWD/flatpak/node-sources.ci.json" pnpm "$PWD/pnpm-lock.yaml"
node flatpak/prepare-ci-manifest.mjs
flatpak-builder --user --install-deps-from=flathub --install --force-clean \
  build-flatpak io.github.TheZwiss.backspace.ci.yml
flatpak run io.github.TheZwiss.backspace
```

This fork does not publish a Flathub package or automatically update Flatpak
release metadata. Historical AppStream entries, source pins and offline sources
are preserved as a matching pair, not rewritten by a desktop release. Optional
`update-release.mjs` / `release-summary.mjs` tools and their tests remain available
for deliberate packaging work; they do not publish anything on their own.

The main CI runs the Flatpak tooling's Node tests, validates the SDK references
and checks release pairing on PRs. It does **not** run a two-architecture Flatpak
build. Generate and build locally using the commands above when testing the
actual sandbox package; ordinary dependency changes need no committed generated
source list.

To build a single-file bundle after either build above, export the local
repository created by `flatpak-builder`:

```sh
flatpak build-bundle ~/.local/share/flatpak/repo Veyvox.flatpak \
  io.github.TheZwiss.backspace
```

The manifest intentionally does not expose the host home directory or the
unrestricted system bus. Network, audio, host devices (for direct webcam
access), DRI graphics, notifications, and the status notifier are enabled
because they are core desktop-client features. System-bus access is limited to
UPower so Chromium can observe battery state. PipeWire screen capture goes
through the desktop portals.
Global keybind behavior is desktop-dependent: X11 supports the bundled native
hook, which is rebuilt against the bundled Electron headers. Wayland uses the
GlobalShortcuts portal and requires a supporting desktop backend and user consent.
The first visit to Keybinds registers all available actions; subsequent launches
restore registration from the portal. Assign, change or remove shortcuts in the
system settings under Veyvox. The app displays a read-only list and allows
retrying a denied/closed session. Browser/X11 local bindings are ignored on
Wayland, including when its portal backend is unavailable. No extra Flatpak bus
permission is required. Activity detection follows
the same platform limits as global keybinds; it is not disabled merely because
the app is packaged as Flatpak. Electron's current start-at-login integration
does not work across the sandbox boundary, so the client hides that setting;
use the desktop environment's autostart settings instead.

## Release-paired offline sources

The committed `node-sources.json` belongs to the release commit the manifest
pins, not to the working tree: it is generated from that release's lockfile,
and the published manifest builds only with that pair. The two move together,
in a deliberate packaging update. Ordinary dependency PRs must not regenerate
or hand-edit `node-sources.json`; local checkout builds use
`node-sources.ci.json`, generated from their own lockfile.

The main `.github/workflows/ci.yml` enforces this on pull requests with
`flatpak/sources-pairing.mjs`: it fails when
`flatpak/node-sources.json` changes while the pinned `commit:` in
`io.github.TheZwiss.backspace.yml` stays the same, and passes any change that
moves the pin. It compares the PR's base/head revisions; a dependency-only
lockfile update leaves this historical pair intact. The unit tests also exercise
changed/deleted sources with an unchanged pin and unreadable revisions.

CI runs `flatpak/node-sdk-version.mjs` on every run: each reference
to the Node SDK extension in this README and
`prepare-ci-manifest.mjs` must name an extension from the manifest's
`sdk-extensions` on its `runtime-version` branch. Moving to a new freedesktop
runtime fails the pull request until all of them move with the manifest.
