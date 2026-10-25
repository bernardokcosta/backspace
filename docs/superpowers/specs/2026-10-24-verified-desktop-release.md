# Spec: Verified desktop release

**Module id:** `verified-desktop-release`
**Status:** Single-writer implementation and 1.15.1 source preparation complete; review, real matrix verification and publication/deployment pending.
**Initiative:** [Desktop 1.15.1](2026-10-24-desktop-1.15.1-design.md)

The initiative defines shared commands, style, dependencies and boundaries.

## Objective

Ship **Backspace Fork 1.15.1** as one complete GitHub release with functioning
desktop update metadata, then deploy and activate its minimum-version policy.
Do not repeat the split-artifact 1.15.0 publication or strand outdated desktops.

## Publication contract

1. Use one writer to create/select the release and finalize uploads. Matrix
   builds produce independently verifiable artifacts; they must not create,
   publish or discover competing releases on their own.
2. Carry the exact validated release id through final upload/publication. Check
   its repository, tag, target commit and draft/public state; do not assume a
   tag listing proves there is only one matching draft.
3. Preserve existing public release activity and custom notes on reruns. Do
   not unpublish a release, move a tag, silently replace different bytes or
   delete someone else's draft merely to make a workflow green.
4. A failed native build, load check, fuse check, macOS signature check,
   artifact download or validation fails the release gate. Keep unsigned and
   ad-hoc-signed capabilities honest; new paid signing is not in scope.
5. Artifact aggregation must detect missing files, conflicting duplicate names
   and partial matrix results. Prove the chosen build/publication mode still
   generates the updater manifests; do not infer that `--publish never`
   necessarily generates every `latest*.yml` file.
6. Require the following **16 unique uploaded assets**, excluding GitHub's
   automatically generated source archives:

```text
Backspace-Fork-1.15.1-win-x64.exe
Backspace-Fork-1.15.1-win-x64.exe.blockmap
Backspace-Fork-1.15.1-win-arm64.exe
Backspace-Fork-1.15.1-win-arm64.exe.blockmap
Backspace-Fork-1.15.1-linux-x86_64.AppImage
Backspace-Fork-1.15.1-linux-amd64.deb
Backspace-Fork-1.15.1-linux-arm64.AppImage
Backspace-Fork-1.15.1-linux-arm64.deb
Backspace-Fork-1.15.1-mac-x64.dmg
Backspace-Fork-1.15.1-mac-x64.dmg.blockmap
Backspace-Fork-1.15.1-mac-arm64.dmg
Backspace-Fork-1.15.1-mac-arm64.dmg.blockmap
latest.yml
latest-linux.yml
latest-linux-arm64.yml
latest-mac.yml
```

7. All assets are complete and nonempty. Each updater manifest declares
   `version: 1.15.1`; every referenced file exists with matching size and
   SHA-512. Uploaded bytes match their expected SHA-256 digests. Validate both
   Windows architecture entries, not just the first/legacy path.
8. Maintain fork app identity, publisher repository, source offer, naming and
   platform download links. Publish accurate notes with a summary paragraph,
   features, limitations and download table; avoid accidentally invoking
   unrelated upstream-only Flatpak automation as part of this repair.
9. Verify anonymous release/download access and the latest-release/update
   endpoints after publication, not only authenticated draft API responses.

## Safe rollout and recovery

1. Finish all code, native, color/hardware, packaging and CI release gates.
   Record unavailable checks as blockers rather than assumed passes.
2. Bump all five version manifests together, commit/push the reviewed code and
   tag **v1.15.1** once. Do not alter the existing **v1.15.0** tag.
3. Publish/verify installers and updater metadata. Verify the GHCR image's OCI
   revision matches the release commit.
4. Take a fresh consistent production SQLite snapshot and save the old
   environment, image id and public instance info without exposing secrets.
5. Deploy the new image with minimum-version enforcement **disabled**. Restart
   only Backspace; preserve the LiveKit deployment and application data.
6. Verify health, version/commit, source offer, instance identity, database
   integrity, browser login and desktop update recovery against the live VM.
7. Only after public artifact and compatibility checks pass, explicitly set
   `BACKSPACE_MIN_DESKTOP_VERSION=1.15.1`, restart the required service and
   verify outdated/current desktop and browser behavior.
8. Retain a rollback record. First disable the version policy if upgrade
   availability fails. A code rollback must preserve current data; restoring
   an older database is never an automatic response to update trouble.

## Tests and success criteria

- Fixture tests reject absent matrix output, missing/wrong-version manifests,
  missing architecture entries, path traversal, hash/size mismatches,
  conflicting duplicate assets and wrong release identity.
- Rerunning publication resumes the same release or fails clearly; it never
  silently creates another public release or overwrites different assets.
- The final gate sees exactly the expected asset set and verifies real updater
  file hashes before publication/enforcement.
- Real public downloads and Windows updater selection work for both x64 and
  arm64. macOS manual updating stays clearly identified as manual.
- The VM reports 1.15.1 with the release commit, healthy application/database,
  unchanged instance identity and the fork's source URL.
- With minimum enforcement active, old desktop access is blocked and its
  update path works; compatible desktop and browser access remain available.
- No release/deployment step is reported complete solely because a workflow
  finished green. Retain evidence of artifact, updater and runtime checks.
