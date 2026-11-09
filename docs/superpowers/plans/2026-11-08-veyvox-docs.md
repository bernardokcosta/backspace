# Veyvox Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish equivalent, welcoming English/pt-BR documentation with accurate upgrade guidance and upstream credits.

**Architecture:** Keep landing-page READMEs short and link existing subsystem guides. Separate current Veyvox instructions from historical/legal attribution and technical compatibility exceptions; document actual tested behavior, not intended capabilities.

**Tech Stack:** GitHub-flavored Markdown, existing project docs, Node built-in test runner for local links/structural contracts; no dependencies.

**Spec:** [veyvox-docs](../specs/2026-11-08-veyvox-docs.md); [integrated plan and constraints](2026-11-08-veyvox-1.17.0.md).

## Global Constraints

- `README.md` in English; `README.pt-BR.md` in Brazilian Portuguese, with language links at the top.
- Credit **Jannis Braun (TheZwiss)** and thank contributors to `https://github.com/TheZwiss/backspace`.
- Veyvox is an independently maintained derivative/community fork, not an official upstream rename or endorsed release.
- Preserve GNU AGPL-3.0-only, original copyright and third-party notices; do not grant upstream commercial-license/trademark rights.
- No invented website, E2EE, native mobile app, signing or universal hardware/support claim.
- Inherit integrated boundaries and deferred-commit policy; this plan follows B/C evidence, not assumptions.

## Review Focus

Execution checkpoint:
- [x] D1 English/pt-BR READMEs, manual claim parity, reciprocal/local-link tests and preserved credits/notices.
- [x] D2 active guides/metadata, current Flatpak checkout guidance and classified compatibility exceptions.
- [x] Docs/Flatpak tests, shell syntax and diff checks.
- [ ] Final whole-scope review and candidate/public link verification; README publication claims remain conditional.

See the validation ledger for actual evidence; detailed release/platform-dependent acceptance remains open.

- User wants to connect, not host a server: D1 gives separate user/operator paths.
- Portuguese claims drift from English: D1 verifies a shared claim/command checklist and manual semantic parity.
- User follows upgrade instructions in a new directory: D1 warns to keep the existing checkout/project/data/env identities.
- README credits accidentally assign supplied art to Jannis: D1 splits original code attribution and maintainer-supplied artwork provenance.
- An old-name scan erases legal/history or leaves broken active links: D2 classifies references and checks links after edits.

---

## Task D1: Write equivalent READMEs and accurate notices

**Files:** Rewrite `README.md`; create `README.pt-BR.md`, `scripts/veyvox-docs.test.mjs`; update `NOTICE`. Preserve `LICENSE`, `LICENSE-COMMERCIAL.md` and third-party license texts; link upstream's separate commercial offer only as historical/upstream information, not an offer covering independent fork changes.

**Interfaces:** Both READMEs use canonical `bernardokcosta/veyvox` source/issues/releases links and B1's actual PNG paths. Their sections cover the same claims: overview, user download/connect, feature summary, operator setup, upgrade/backups, development, security/privacy/limits, license/origin/thanks. Use the release list while artifacts are pending; do not link a nonexistent direct Veyvox installer or advertise publication as complete.

- [ ] **Step 1 — RED assertions:** Add Node tests asserting both files exist, reciprocal language/image/docs links resolve, local Markdown/HTML image targets stay inside the repository, the source/upstream/independence/AGPL credit blocks exist, and the same feature/command/version checklist is represented. Assertions include `Jannis Braun`, `TheZwiss`, the original upstream URL, `Veyvox`, `1.17.0`, `pnpm install --frozen-lockfile`, and new package filters. Relative links with fragments must resolve to real headings, not only existing filenames. No automated test claims semantic translation equivalence.

  Test name: `ships bilingual Veyvox onboarding with original attribution`.
  ```js
  for (const file of ['README.md', 'README.pt-BR.md']) {
    const text = readFileSync(file, 'utf8');
    for (const required of ['Veyvox', 'Jannis Braun', 'TheZwiss', 'https://github.com/TheZwiss/backspace', 'AGPL-3.0']) assert.ok(text.includes(required));
  }
  ```

- [ ] **Step 2:** Run `node --test scripts/veyvox-docs.test.mjs`; expect missing pt-BR/new copy assertions to fail.
- [ ] **Step 3:** Write both versions with: chat/spaces/DMs, optional LiveKit voice/video/sharing, federation, Juno, soundboard, 25 languages, desktop and mobile PWA. Separate download/connect from self-hosting; explain Node >=22.12.0, Node 24 recommendation, pnpm 10, desktop build-tool caveat, dev API `3005`/web `5173`, production `3000`, `JWT_SECRET` >=32 characters and optional voice/network prerequisites. Link existing deployment/security/desktop guides for proxy/TLS/voice details. Source checkout instructions use the renamed repository; upgrades explicitly stay in the existing directory with backups, existing `.env`, data and Compose project, not `install.sh` as a reset. Explain retained legacy keys/paths and manual macOS update/signing limits from measured C5 results.
- [ ] **Step 4:** Update NOTICE with Veyvox as current derivative, original Jannis/code/sound/font/dependency credits intact, and the two new artwork paths recorded as supplied by the maintainer, not authored by Jannis. Do not invent ownership, trademark registration, or an artwork license grant absent from supplied provenance. Manually compare both README claim checklists and render them on GitHub/local Markdown with working PNGs and 320px readability; run the docs test. R1 adds the Node test to CI.
- [ ] **Step 5:** Record semantic/link/provenance checks and queued `docs: introduce bilingual Veyvox READMEs and credits` checkpoint. Block unsupported claims rather than translating them twice.

## Task D2: Reconcile active documentation, examples and remaining old-name references

**Files:** `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, root active guides/examples/scripts and `docs/systems/*.md` matched in P0; `flatpak/README.md`, Flatpak current desktop/metainfo copy, manifest/launcher paths, `scripts/gen-icons.README.md`, active GitHub issue/PR templates/config. Modify the existing validation ledger, not archived release/spec documents merely for cosmetic consistency.

**Interfaces:** Active prose says Veyvox; executable commands continue using exact retained service/storage/env identities from C4. The ledger lists each retained path/pattern, category, reason and relevant regression/evidence. Historical releases, copyright/legal text, keyboard Backspace, user-authored/foreign-instance fixture data and necessary interoperability names remain truthful.

- [ ] **Step 1 — tests/audit:** Run `git grep -n -i backspace` across tracked files and review new files too. Split current docs/examples from `docs/superpowers` history, historical release notes, legal notices and persisted identities. Extend the docs test with broken-link checks for touched active Markdown, both language links, canonical source/download URLs and invariants for retained operational commands (`docker compose ... backspace`, not a nonexistent `veyvox` service).

  Test name: `keeps upgrade commands pointed at the existing Compose service`.
  ```js
  const english = readFileSync('README.md', 'utf8');
  assert.match(english, /docker compose (?:pull|up[^\n]*) backspace/);
  assert.doesNotMatch(english, /docker compose (?:pull|up[^\n]*) veyvox/);
  ```

- [ ] **Step 2:** Run the extended docs test and review the active old-name report. New-name/current-link assertions should fail on still-unconverted guides; passing historical fixtures remain passing.
- [ ] **Step 3:** Update current product prose/filter commands/source URLs and image descriptions in place. Update desktop/security/design/localization/deployment subsystem specs alongside their owning code. For Flatpak retain `io.github.TheZwiss.backspace`/sandbox paths as explicit compatibility identity, change display metadata/source checkout to this fork and keep provenance. Do not mutate old AppStream release entries or run upstream-only release metadata writes. Update current launcher executable references to C1's retained packaged path. Preserve design archives; fix only active references to them.
- [ ] **Step 4:** Run docs/Flatpak tests, touched shell `bash -n`, `git diff --check`, and the complete old-name scan again. Manually inspect every active match; a category exemption must not conceal stale UI copy, a wrong update source or a copied old command that no longer works. Record no-code-change API/schema/federation boundaries; do not rewrite their history or user content.
- [ ] **Step 5:** Record the complete exception inventory and queued `docs: align active guides with compatible Veyvox naming` checkpoint. P1 reviews the entire task, not just these documents.
