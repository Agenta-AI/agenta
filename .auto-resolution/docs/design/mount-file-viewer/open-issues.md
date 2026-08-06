# Open issues

Deferred TODOs and open questions for this project. Each entry carries enough context and
provenance to act on cold. See the `defer-todo` skill for the format.

## Open issues

### Add one-level listing to the mount files endpoint

**Status:** open
**Added:** 2026-07-10
**Commit:** aed3462c42 (branch `gitbutler/workspace`)
**Project:** [Mount file viewer](README.md)
**Source:** implement-feature session for the SessionInspector Mounts tab file browser

**The problem.** `GET /mounts/{id}/files` lists a mount's whole subtree recursively in one
response (`api/oss/src/core/store/storage.py:326`). It has no delimiter or pagination
parameter. The frontend's `deriveRows` (`web/oss/src/components/SessionInspector/assets/mountBrowser.ts`)
narrows this into a one-level (folder, file) view for display, so rendering stays bounded.
The network call does not: opening the root of a large, repo-sized mount transfers the
full recursive tree in a single request and response.

**Why it is deferred.** This slice was scoped frontend-only. The existing backend
endpoints already covered the acceptance checks (folder navigation, breadcrumbs, preview,
download), so fixing the listing endpoint's shape was out of scope. It only matters for
mounts large enough that the full-tree payload becomes slow or heavy, which the test mount
used for this slice was not.

**What to decide or do.** Add delimiter-based one-level listing to
`GET /mounts/{id}/files` (the common S3-style `delimiter=/` pattern), or windowed
pagination, so a folder view can fetch only its direct children. Once the backend
supports it, drop the client-side flattening in `deriveRows` and call the endpoint once
per folder instead of once per mount root.

### Add inline preview for audio, PDF, and video files

**Status:** open
**Added:** 2026-07-10
**Commit:** aed3462c42 (branch `gitbutler/workspace`)
**Project:** [Mount file viewer](README.md)
**Source:** live e2e verification of the SessionInspector Mounts tab file browser

**The problem.** The preview panel in `MountsTab.tsx` only handles two kinds: text
extensions render inline via the `read=` endpoint, and image extensions render inline via
a blob object URL. Everything else falls to a "No preview available" message plus a
Download button. The test mount used for e2e verification held mp3, wav, pdf, and mp4
files, all of which currently fall to Download.

**Why it is deferred.** The plan scoped preview to text and images only
(`docs/design/mount-file-viewer/plan.md`). Audio, PDF, and video previews are each a
different rendering strategy (an `<audio>`/`<video>` element from the same blob path
already built, versus an embedded PDF viewer), and none were required by the acceptance
checks.

**What to decide or do.** Decide whether audio/video/PDF preview is worth the added
surface. If yes, audio and video can likely reuse the existing blob-fetch path
(`fetchMountFileBlob` in `SessionInspector/api.ts`) with `<audio>`/`<video>` elements added
to `FilePreview`. PDF needs either a PDF.js-based viewer or an iframe pointed at the blob
object URL; check the app for prior art before adding a dependency.

### Wire colocated oss/src vitest files into CI

**Status:** open
**Added:** 2026-07-10
**Commit:** aed3462c42 (branch `gitbutler/workspace`)
**Project:** [Mount file viewer](README.md)
**Source:** implement-feature session, Phase 4 (tests)

**The problem.** This slice added
`web/oss/src/components/SessionInspector/assets/mountBrowser.test.ts`, a colocated vitest
file that follows repo precedent (`TemplateStrip/assets/pagerMath.test.ts`). It runs fine
locally (`npx --yes vitest@4.1.10 run <path>` from `web/oss`), 9/9 passing. The CI unit-test
harness only runs each package's `test:<layer>` script, so colocated `oss/src/**/*.test.ts`
files, this new one included, never run in CI.

**Why it is deferred.** This is a pre-existing gap, not something this slice introduced.
`pagerMath.test.ts` has the same status today. Wiring an oss-app vitest layer into CI is
infrastructure work independent of any one feature and affects every future colocated test
in `web/oss/src`, not just this one.

**What to decide or do.** Add a `test` (or `test:oss`) script and CI step that runs vitest
across `web/oss/src/**/*.test.ts`, matching how package-level `test:<layer>` scripts run
today. Until then, treat colocated oss/src tests as locally-verified only and say so in any
PR that adds one.

### Migrate off the deprecated antd List component in the Mounts tab

**Status:** open
**Added:** 2026-07-10
**Commit:** aed3462c42 (branch `gitbutler/workspace`)
**Project:** [Mount file viewer](README.md)
**Source:** live e2e verification of the SessionInspector Mounts tab file browser

**The problem.** The browser console shows an antd deprecation warning for the `List`
component used to render mount file rows in `MountsTab.tsx`. The tab used `List` before
this slice too, so the warning predates this change; this slice's `MountFilesPanel` keeps
using it for the new file-row list.

**Why it is deferred.** It is a pre-existing pattern across the tab, not a regression from
this slice, and antd has not yet published a stable replacement pattern the rest of the
codebase has adopted.

**What to decide or do.** Migrate when antd's replacement guidance lands and other call
sites in the codebase start moving off `List`, so the Mounts tab moves as part of a
codebase-wide sweep rather than in isolation.

### Include the file listing in the mount markdown dump

**Status:** open
**Added:** 2026-07-10
**Commit:** aed3462c42 (branch `gitbutler/workspace`)
**Project:** [Mount file viewer](README.md)
**Source:** plan.md non-goals, carried forward at implementation time

**The problem.** `dump.ts`'s `mountsMarkdown` renders mount metadata only (name, slug, id).
It does not include the file listing this slice added to the Mounts tab UI, so the
markdown dump (used wherever the session gets exported or summarized as text) still cannot
show what files a mount holds.

**Why it is deferred.** The plan scoped `dump.ts` as untouched for this slice
(`docs/design/mount-file-viewer/plan.md`, "leave `mountsMarkdown` as is (metadata only) for
this slice"). Extending it needs its own decision about how much of the listing to inline
(the whole tree risks the same unbounded-payload problem as the one-level-listing issue
above) and was not part of the reviewed scope.

**What to decide or do.** Decide whether the markdown dump should show a bounded file tree
(for example, first-level entries only, or a depth cap) and extend `mountsMarkdown` to call
`fetchMountFiles` accordingly. Coordinate with the one-level-listing backend follow-up
above so the dump does not fetch a full recursive tree either.
