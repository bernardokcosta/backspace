# Spec: recover media-tool availability after transient failure

## Status and objective

Approved by the user on 2026-11-10; module `media-probe-recovery` in the
[approved capability map](2026-11-10-operational-resilience-map.md).

A temporary startup failure checking `ffprobe` must not disable video
thumbnails and metadata extraction for the entire server process lifetime.
Missing tools must still degrade safely without repeated process spawning.

## Evidence and assumptions

- `checkFfmpeg` permanently caches both success and failure. A local reproduction
  confirms that a first transient rejection prevents any later successful probe.
- Three retained startup warnings occur five seconds after startup, including
  the current version. At inspection, `ffprobe -version` succeeds as the same
  non-root user as the server. The original exception is not retained: timeout
  is plausible, but not conclusively identified.
- Keep the existing external `ffmpeg`/`ffprobe` tools, `execFile`, Sharp and
  upload/media callers. No new dependency, shell invocation or privileged user.
- A failed optional probe never fails startup, chat or an otherwise valid upload.

## Required behavior

- Keep cached successful availability. A failed check is retryable after a
  bounded cooldown rather than permanently disabling media processing.
- Coalesce concurrent checks into one in-flight probe; the boot check and a
  simultaneous upload must not each spawn their own process.
- Preserve timeout and output bounds. Do not increase timeout indefinitely,
  poll continuously or retry every upload when the executable is truly missing.
- Distinguish an absent executable from a transient timeout/process failure in
  safe diagnostics using existing recognized fields/call-site metadata. Do not
  log command output, uploaded filenames, local paths or arbitrary error text.
- Existing thumbnail and metadata callers recover on a later demand after a
  failed probe's cooldown. No background scan, backfill or rewrite of old uploads
  is included, and existing public function behavior remains compatible.

## Structure and style

Use `packages/server/src/utils/thumbnail.ts` and colocated unit tests. Preserve
the existing async `checkFfmpeg(): Promise<boolean>` interface and
`execFile('ffprobe', ['-version'], { timeout: 5000 })` process invocation shape.
Prefer a small in-flight promise and retry deadline next to the existing cache
over a new global job/health framework. Update `docs/systems/uploads.md` to
describe demand-driven recovery if its availability behavior changes.

## Success criteria and testing

- A simulated first timeout followed by a healthy executable returns false
  initially, avoids probing during cooldown, and returns true on a later check
  without restarting the process.
- Concurrent callers share one process and receive the same result. Both
  rejection and success settle and release the in-flight slot.
- Missing executable, non-zero exit and timeout remain bounded, do not throw to
  callers and do not produce a warning/process storm.
- Success remains cached, output remains bounded, and existing upload/file
  behavior and non-fatal thumbnail fallback remain intact.
- Tests use mocked child processes and fake time, not production files. Verify
  the real executable under a disposable local/Linux runtime when available;
  inability to validate a particular platform remains explicit.

```bash
pnpm --filter @veyvox/server test -- thumbnail
pnpm --filter @veyvox/server test -- files
pnpm --filter @veyvox/server typecheck:e2e
pnpm typecheck
pnpm lint
pnpm build
```

## Boundaries

Always preserve non-fatal upload behavior, bounded resource use and non-root
execution. Ask before changing tooling/dependencies or scheduling a restart.
Never reinstall packages inside production containers, modify stored media,
change system capabilities or claim historical uploads have been repaired.
