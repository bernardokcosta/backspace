# Spec: veyvox-release

Parent: [Veyvox 1.17.0](2026-11-08-veyvox-1.17.0.md). Depends on brand,
compatibility and documentation; inherits parent commands/style/boundaries.

## Objective and authorized operations

After validation, commit/push the complete change, rename the existing public
`bernardokcosta/backspace` repository to `bernardokcosta/veyvox`, update its About
description/topics, and publish release **Veyvox 1.17.0**. Keep owner, visibility,
history and prior releases. Do not create a new repository or deploy a server.

Proposed About description (English, within GitHub's 350-character limit):

> Self-hosted communication for communities: chat, voice, video, screen sharing,
> federation, and Juno. An independent AGPL-3.0 fork of Backspace.

Topics: `veyvox`, `self-hosted`, `chat`, `voice-chat`, `video-chat`,
`screen-sharing`, `federation`, `discord-alternative`, `typescript`, `react`,
`electron`, `webrtc`, `livekit`, `docker`, `open-source`, `agpl-3-0`, `juno`.
Leave Website unset unless a real project website is supplied; do not invent one.

## Existing release contracts

- Reuse `scripts/bump-version.mjs`; all workspace versions become 1.17.0.
- Product/installer filenames become Veyvox consistently in builder config,
  download selection, release inventory/verification and updater manifests.
- Update actual fork repository/source/publisher metadata to the renamed GitHub
  repository while keeping original Backspace links only for attribution/history
  and compatibility. Test old public URLs instead of assuming redirects suffice.
- Keep existing release inventory integrity checks, publisher host/redirect/token
  protections, native SDR verification, Electron fuses and macOS signature checks.
  No new dependencies, bypasses, unsigned-state misrepresentation or edited tags.
- Preserve a working public container upgrade path. Registry slugs are not
  renamed blindly with the repository; a new image path cannot replace a working
  legacy path until its anonymous accessibility and old-install compatibility are
  independently verified.

## Required order

1. Complete local changes, full tests/build/typechecks/lint/i18n, isolated UI and
   old→new data/installation fixtures, then one full-scope external Sol review.
2. Resolve findings and rerun affected checks. Commit only intended files; leave
   unrelated original-checkout skills work outside this worktree and release.
3. Rename the GitHub repository/update metadata and local origin safely, then
   push the candidate branch to the renamed repository. Check redirects/links.
4. Run the existing **read-only** release candidate workflow and verify all
   platform artifacts/inventory before creating a version tag. Fix failures;
   no partial public release or weakened validation.
5. Integrate into current `master` without force, dropping or overwriting other
   contributors' work. Require successful main-branch CI for the **exact final
   release commit**, as the existing publisher already enforces.
6. Create/push only immutable `v1.17.0` at that validated commit. Let the existing
   gated workflows build/validate/publish; do not manually bypass their writer.
7. Verify the published release title/tag/commit, complete expected asset set,
   checksums/version/publisher/updater references, public source/download URLs and
   container availability. Report actual results, not merely a dispatched job.

## Failure boundaries

Unavailable target name/permissions, unsafe migration, conflicting remote changes,
failed CI/build/packaging or private/unavailable required artifacts block the
affected publication step. Preserve the evidence and report the blocker. Never
move a public tag, replace release bytes, delete another release, force-push or
change a real installation to manufacture a green result.
