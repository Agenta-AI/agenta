# Status

Source of truth for progress.

- **2026-07-10** — Workspace created from in-conversation research (user approved the
  minimal-scope plan in chat and asked to implement; plan-feature ran inline as part of
  the same session rather than as a separate draft-PR round).
- Phase 0 (refresh plan): done — citations verified against the working tree this session.
- Phase 1 (implement slice 1): done. `api.ts` gained `fetchMountFiles` / `fetchMountFileText`
  / `fetchMountFileBlob` (blob via shared axios: the generated Fern `downloadMountFile`
  always JSON-parses the body, so a Blob is unreachable through it). `MountsTab.tsx`
  rewritten: Collapse per mount, lazy listing per path with breadcrumbs, inline preview
  panel (text/image/other + download), 2 MB cap. `.md` renders as plain text for now (the
  app's markdown renderer is chat-bubble-specific). Lint clean; tsc clean on touched files.
- Phase 2 (review): round 1 requested changes. Main finding (confirmed live by Mahmoud on
  the dev box): the listing endpoint is recursive and flat with mount-root-relative paths,
  and folder rows exist only for explicit marker objects — the first cut flattened nested
  files at root and duplicated them inside folders. Fixed via client-side `deriveRows`
  (prefix strip, synthetic folder rows by first segment, marker merge/dedupe, folders
  first). Nits fixed: deferred object-URL revoke after download; object URL creation moved
  from useMemo to useEffect. Re-review round 2: one real bug — `deriveRows` keyed folder
  detection off a trailing slash the backend never sends instead of `entry.is_folder`
  (empty folders rendered as files and 404'd on preview; marker-backed folders duplicated).
  Fixed with the reviewer's one-liner (`entry.is_folder || relative.endsWith("/")`);
  everything else in the derivation verified OK. Lint + tsc clean on touched files.
- Phase 3 (e2e): live run on the dev box against Mahmoud's test session — 7/8 pass
  (folder nav + breadcrumb, text preview, image preview, 2 MB cap, no-preview+download,
  console clean of functional errors, dark mode). 1 fail: the round-2 one-line fix
  unconditionally sliced the marker entry's last character (`is_folder` markers carry no
  trailing slash), yielding a phantom `file_explorer_test_asset` folder row. Fixed (slice
  only on an actual trailing slash); re-verification of the root listing in progress.
  Screenshots in the session scratchpad `e2e/` dir. Note: antd `List` deprecation warning
  in console — pre-existing pattern (the old tab used `List` too), no action this slice.
- Phase 3 result: 8/8 acceptance checks pass live after the phantom-row fix (re-verified
  in-browser on the same session).
- Phase 4 (tests): done. `deriveRows` moved into `SessionInspector/assets/mountBrowser.ts`
  with a colocated vitest file (repo precedent: `TemplateStrip/assets/pagerMath.test.ts`),
  pinning the two bugs review found (an `is_folder` marker without a trailing slash; a
  folder that never turns into a file row). 9/9 tests pass:
  `npx --yes vitest@4.1.10 run src/components/SessionInspector/assets/mountBrowser.test.ts`
  from `web/oss`. Eslint clean and `tsc` clean on the touched files. Note: colocated
  `web/oss/src/**/*.test.ts` vitest files are not wired into the CI harness (it runs
  package `test:<layer>` scripts only) — same status as the existing colocated tests; see
  `open-issues.md`.
- Note: known v1 limit — the backend has no true one-level listing, so a huge mount still
  returns its full recursive listing (narrowed by `path`) in one response. Deferred:
  see `open-issues.md`.
- Phase 5 (docs + PR body): done. `status.md` updated, `open-issues.md` written with the
  deferred items below, `pr-body.md` written for
  `feat(frontend): browse and preview mount files in the session inspector`.
- Phase 6 (GitButler lane over big-agents): pending.

## Where this stands

The slice is complete and verified (lint, tsc, 9/9 vitest, 8/8 live e2e). It has landed in
the working tree pending commit and PR: Phase 6 (GitButler lane + PR) is the only step
left.

## Deferred / follow-ups

Full context and provenance for each item lives in `open-issues.md`. Short list:

- Agent/application-level mounts: separate design discussion (see conversation notes in
  research.md scope), not this slice.
- Backend one-level listing: the listing endpoint is recursive with no delimiter, so a
  large mount transfers its full tree in one response.
- Inline preview for more file types (audio, PDF, video).
- Colocated oss/src vitest files, including `mountBrowser.test.ts`, are not wired into CI.
- The antd `List` deprecation warning in the tab (pre-existing pattern).
- `dump.ts` could include a file listing in the markdown dump later.
