## Context

The playground's SessionInspector drawer has a Mounts tab. For a session with a durable
cwd mount full of files, the tab showed only each mount's `name / slug / id`. Users could
see that a mount existed but not what the agent wrote into it, let alone read a file. The
backend already exposed everything needed (`GET /mounts/{id}/files` for listing, `?read=`
for text, `/files/download` for raw bytes), so the tab just never called it.

Before: expanding a mount showed three lines of metadata.
After: expanding a mount shows its files, folders first, with breadcrumb navigation.
Clicking a file previews it inline (text or image) or offers a Download button.

## Changes

`api.ts` gained three fetchers: `fetchMountFiles`, `fetchMountFileText` (both through the
Fern `mounts` client), and `fetchMountFileBlob`. The blob fetcher goes through the shared
axios instance instead of Fern, because the generated `downloadMountFile` always
text/JSON-parses the response body, so a `Blob` is unreachable through it. The function
carries a one-line comment explaining why.

`MountsTab.tsx` replaced the flat metadata `List` with a `Collapse`, one panel per mount.
Expanding a panel queries the root listing; clicking a folder row re-queries with that
folder's path. Clicking a file opens an inline preview: text extensions render through
`read=`, image extensions fetch a blob and render it via an object URL, everything else
(and anything over 2 MB) shows a Download button instead.

The listing endpoint is recursive and flat: it returns every file under a path in one
response, with paths relative to the mount root, and folders only show up as `is_folder`
marker entries with no trailing slash. `deriveRows` (new file,
`assets/mountBrowser.ts`) derives the one-level view the UI needs: it groups entries by
their first path segment past the current folder into synthetic folder rows, merges those
with any explicit folder markers so a folder never appears twice, and returns folders
before files, both sorted alphabetically. It is unit-tested (9 tests,
`assets/mountBrowser.test.ts`, colocated per repo precedent like
`TemplateStrip/assets/pagerMath.test.ts`), including regression tests for the two bugs
review caught (see below).

## Scope / risk

Frontend only. Files touched: `SessionInspector/api.ts`, `SessionInspector/tabs/MountsTab.tsx`,
and the new `SessionInspector/assets/mountBrowser.ts` + `mountBrowser.test.ts`. No backend
changes, no Fern regen, no new endpoints.

`dump.ts` (the markdown export of a session's mounts) is untouched and still shows metadata
only; it does not gain a file listing in this PR. Nothing outside the Mounts tab changes,
so the only realistic regression surface is that tab itself: mounts with zero files, mounts
that fail to load, and sessions with zero mounts all need to keep working (all three are
covered in QA below).

The blob-fetch axios exception is intentional, not a drift from the Fern convention:
`web/AGENTS.md` requires Fern for new endpoint calls, and `fetchMountFiles` /
`fetchMountFileText` follow that. `fetchMountFileBlob` calls the same endpoint Fern already
wraps; it bypasses Fern only because Fern's generated method parses every response body as
JSON before handing it back, which makes a binary `Blob` unreachable no matter how the
call is made. The listing and text fetchers stay on Fern.

One known v1 limit, tracked in `open-issues.md`: the listing endpoint has no one-level or
delimiter mode, so a very large mount's root view transfers its full recursive tree in one
response. The frontend derivation bounds what renders, not what is fetched.

## Tests / notes

- `npx --yes vitest@4.1.10 run src/components/SessionInspector/assets/mountBrowser.test.ts`
  from `web/oss`: 9/9 passing.
- Eslint clean, `tsc` clean on the touched files.
- Colocated `web/oss/src/**/*.test.ts` vitest files, this one included, are not wired into
  the CI unit-test harness (it runs package `test:<layer>` scripts only). Logged as a
  deferred item in `open-issues.md`; same status as the existing colocated tests.
- Review caught two real bugs before this landed: a first cut flattened nested files at
  the mount root and duplicated them inside folders (the listing is recursive, not
  one-level); a second cut keyed folder detection off a trailing slash the backend never
  sends, so empty folders rendered as files and 404'd on preview, and a later one-line fix
  for that unconditionally sliced a marker entry's last character, producing a phantom
  folder row. All three are pinned as regression tests in `mountBrowser.test.ts`.

## How to QA

**Prerequisites:** local dev stack (`run.sh` with your usual OSS or EE flags), and a
session whose cwd mount has nested files. If you don't have one, run a playground agent
that writes a few files into its cwd, including a subfolder, a text file, an image, and a
file over 2 MB.

**Steps:**

1. Open the playground, run or pick a session with that mount, and open the
   SessionInspector drawer.
2. Go to the Mounts tab and expand the mount panel.
3. Click into a subfolder, then use the breadcrumb to navigate back to root.
4. Click a `.md` or `.txt` file.
5. Click a `.png` or other image file.
6. Click a file over 2 MB.
7. Click a file type with no preview support (for example `.mp3` or `.pdf`).
8. Toggle dark mode and repeat steps 2-4.

**Expected result:**

- Step 2: the panel shows folders first, then files, each file with a human-readable size.
- Step 3: the folder's children show; the breadcrumb takes you back to the same root view.
- Step 4: the file's text content renders inline in a scrollable panel.
- Step 5: the image renders inline.
- Step 6: no preview; a Download button appears and downloads the file.
- Step 7: "No preview available" plus a working Download button.
- Throughout: no console errors, and the drawer still opens fine for sessions with zero
  mounts.
- Step 8: the tab and preview panel look correct in dark mode too.

**Automated tests:**

```shell
npx --yes vitest@4.1.10 run src/components/SessionInspector/assets/mountBrowser.test.ts
```

(run from `web/oss`)

**Edge cases:** a mount with an explicit empty-folder marker must show a folder row, not a
file row and not a phantom row with a truncated name (both were real bugs, now pinned in
`mountBrowser.test.ts`). A mount with a same-named file and folder at the same path (for
example a file `a` and a folder `a/`) must show both as separate rows. Re-check dark mode
on the preview panel specifically, not just the file list.

https://claude.ai/code/session_018MaXPNpvzN22kngHno3VMj
