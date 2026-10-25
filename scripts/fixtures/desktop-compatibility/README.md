# Disposable desktop identification probe

Status: tooling implemented; **no real 1.14.2/1.15.0 identification evidence yet**.
Synthetic Node tests are not shipped-host samples and must never be labelled as
such. Do not choose legacy-version parsing rules from Electron's version.

## Safe procedure

1. Use a disposable OS account/VM, not the installed app's account or profile.
   The old app can change protocol/login settings and check for updates at boot;
   an Electron `--user-data-dir` flag alone is not OS-account isolation.
2. Obtain each original installer from the trusted fork release. Record the
   exact asset id, version, architecture, upstream digest and locally calculated
   SHA-256 before running it. Preserve existing releases and assets.
3. Install/run it only inside that disposable environment. Do not copy the
   user's installed profile, credentials, cache, drafts or production instance.
4. In that environment start the loopback-only probe with a **new absolute**
   output filename in an approved temporary directory, for example:

   ```sh
   node scripts/probe-desktop-compatibility.mjs --listen 127.0.0.1 --port 3088 --output <absolute-new-temp-file.jsonl>
   ```

5. Set `BACKSPACE_URL=http://127.0.0.1:3088` for that disposable app process
   only. Confirm the displayed page is the probe before interacting. Never log
   in. Repeat the handshake with the page's button and after an isolated app
   restart, then stop the probe with Ctrl+C. Do not change the real app's instance.
6. Inspect the sanitized JSONL before sharing. It allows only bounded UA,
   installed-version/platform, known bridge-method presence and update mode.
   Update mode is read from the existing `getUpdateStatus().capability`; the
   snapshot's status/error details are never included. `openReleasePage` and
   update/install actions are detected for presence only, not invoked.
   Authorization/cookies/URL queries, arbitrary headers, request content and
   WebSocket auth/data frames are not recorded. The file is created exclusively
   (never overwritten), with at most 128 records; no test creates accounts or
   downloads/installs updates through the bridge.

## Evidence still required

- Actual original 1.14.2 and 1.15.0 startup/restart UA and getVersion values,
  with verified installer provenance. Only the new explicit token format may
  be designed before these samples exist; legacy app formats must be observed.
- Existing service-worker bundle and active-call behavior across an isolated
  instance deployment/policy transition, with a simultaneous valid browser/bot
  session. This probe intentionally cannot establish those facts: it is not a
  production-API or LiveKit simulator and immediately closes WebSocket handshakes.
- Real updater readiness/relaunch from old hosts in those disposable profiles.

Until those gates pass, server enforcement, release and production policy
activation are blocked. Do not fabricate header samples or treat the sanitized
fixture/test UA as an observed Backspace client.
