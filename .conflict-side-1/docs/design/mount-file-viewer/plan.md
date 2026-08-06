# Plan

One shippable slice, frontend only.

## Slice 1: Mounts tab file browser + preview

### Changes

All inside `web/oss/src/components/SessionInspector/`:

1. **`api.ts`** — three new fetchers, following the file's existing style
   (`getAgentaSdkClient`, `scope(projectId)` for `queryParams.project_id`):
   - `fetchMountFiles(mountId, projectId, path?)` → `client().mounts.getMountFiles(...)`,
     returns `{count, files: {path, size, is_folder}[]}`. The generated method is typed
     `unknown`; declare a local response type and cast.
   - `fetchMountFileText(mountId, projectId, path)` → same method with `read: path`,
     returns `{path, content}`.
   - `fetchMountFileBlob(mountId, projectId, path)` → the download route, returning a
     `Blob`. Try the Fern `downloadMountFile(...).withRawResponse()` first; if the body is
     already consumed/parsed, fall back to the shared axios instance
     (`@/oss/lib/api/assets/axiosConfig`) with `responseType: "blob"` and a one-line
     comment saying why Fern is bypassed (binary body).

2. **`tabs/MountsTab.tsx`** — replace the flat `List` with:
   - An antd `Collapse`, one panel per mount (header keeps `name ?? slug ?? id` + mono id).
   - On panel expand, `useQuery` the root listing. Folders lazy-load on click by
     re-querying with `path` (indent or breadcrumb navigation; no tree component).
   - File rows show name + human-readable size.
   - Clicking a file opens a preview inside the drawer (inline panel or `EnhancedModal`
     from `@agenta/ui` — implementer's call, whichever reads better in the drawer):
     - Text extensions (`md, txt, json, yaml, yml, py, ts, tsx, js, log, csv, toml, sh`,
       and extensionless) → `read=` → `<pre>` with wrap. `.md` renders through the
       markdown renderer already used in the app if trivially importable, else plain text.
     - Image extensions (`png, jpg, jpeg, gif, svg, webp`) → blob → object URL → `<img>`.
       Revoke object URLs on close/unmount.
     - Anything else → "No preview" + a download link (same blob → anchor download).
   - Guards: skip preview when `size > 2 MB` (show download instead); per-query loading
     and error states; empty-folder state.

3. **`dump.ts`** — leave `mountsMarkdown` as is (metadata only) for this slice.

### Conventions that apply

- `web/AGENTS.md`: Fern client for new API calls, TanStack Query via `useQuery` (the tab
  already uses it), Tailwind classes, antd semantic color tokens, light + dark theme,
  terse comments, `pnpm lint-fix` in `web/` before done.
- State stays local to the tab (component state / `useQuery`), no new atoms needed.

### Acceptance check

Against a live session whose cwd mount contains files:
1. Mounts tab lists the mount; expanding shows the file listing with sizes.
2. Entering a folder shows its children; navigating back works.
3. Clicking a `.md` or `.txt` file shows its text; clicking a `.png` shows the image.
4. A file over 2 MB offers download instead of preview.
5. Unknown binary (e.g. `.zip`) shows "No preview" + working download.
6. No console errors; drawer still works for sessions with zero mounts.
7. Both themes look right.
