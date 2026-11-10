# Version-neutral Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve PR21/22 intent with correct bilingual onboarding and durable README contract tests.

**Architecture:** Real Git merges preserve original docs commits. Amend only incomplete copy, inconsistent placeholder notation and stale version-specific assertions; reuse existing link/image/attribution checks.

**Tech Stack:** Existing Markdown, Node24 node:test, Sharp tooling.

**Spec:** `docs/superpowers/specs/2026-11-10-version-neutral-docs.md`

## Global Constraints

- No app/package version bump, download publication, tag/release, signing-policy change or attribution removal.
- Keep real architecture suffixes, formats, public legacy image channel, ports and secure commands.
- Same isolated integration branch and whole-change review as the dependency plan; no per-task agent.

## Review Focus

- A placeholder must not become a dead concrete download URL; assert Releases guidance and no versioned download links.
- English/Portuguese/macOS placeholders must agree; assert every platform pattern in both READMEs.
- Source version must be discoverable without a frozen release number; assert package.json link.
- Real local links and transparent image checks must remain; retain current tests.
- Original author/license/operational identities must survive neutral copy; retain contract assertions.

## File map

Modify `README.md`, `README.pt-BR.md`, `scripts/veyvox-docs.test.mjs` only, plus task specs/progress. No new production component or dependency.

### Task1: Integrate and correct onboarding

**Interfaces:** filenames use the literal documented `<version>` placeholder; source version links to `package.json`, published builds link to GitHub Releases.

- [x] Record current PR21/22 heads, merge both preserving ancestry and run `node --test scripts/veyvox-docs.test.mjs`; observe stale1.17.0 assertion RED.
- [x] Add assertions for bilingual manifest link, three platform patterns using `<version>`, retained signing/sidecar/attribution/security guidance. Reject inconsistent `x.xx.x`/`x.x.x` and incomplete source-version phrases.
- [x] Replace incomplete source-version prose with manifest guidance and consistently label installer patterns in both languages; remove only the historical1.17.0 requirement from the test, not substantive safety checks.
- [x] Run `node --test scripts/veyvox-docs.test.mjs scripts/veyvox-brand.test.mjs`, all tooling tests and diff/local-link checks; require GREEN.
- [x] Include all docs/test changes in the single final external review before fix commit/publication.

## Self-review

Every review edge is pinned by an assertion or retained link/image contract. Version-neutral docs do not change the actual app release or installer naming contract.
