# Implementation divergences

## `queryMountDir` needs a public export

The plan says the pre-write check should call the same `queryMountDir` fetcher as
`mountDirQueryFamily`, but it only lists `mountDirQueryKey` among the new session-package barrel
exports. The fetcher is public in
`web/packages/agenta-entities/src/session/api/api.ts:636`, while the package's only public session
barrel does not export it beside the other mount reads
(`web/packages/agenta-entities/src/session/index.ts:22-26`).

The implementation also exports `queryMountDir` from `@agenta/entities/session`. This keeps the
pre-write check on the existing validated Fern boundary instead of duplicating the request in the
app layer or importing an unexported package-internal path.

## A drive swap must preserve the old explorer when the user keeps editing

The plan says a drive swap should remount `DriveExplorer` and show the guard above that boundary.
After that remount, however, **Keep editing** has no valid editor surface: the new drive cannot
resolve the old buffer's mount and path, and the mismatch effect would reopen the same guard.

`FilesDrawer` therefore holds the last displayed drive while the dirty-buffer guard is unresolved
(`web/oss/src/components/Drives/FilesDrawer.tsx:107-119`). Discarding, cancelling, closing, or a
successful save clears the buffer and releases the incoming drive; keeping the edit leaves the old
explorer mounted. The one-shot drive-swap intent is owned by `useDriveEditGuard`
(`web/oss/src/components/Drives/editMode/useDriveEditController.ts:385-420`).

## Edit availability also waits for the parent listing

The plan derives Edit availability only from the loaded content and reads `baseMtime` with
`queryClient.getQueryData` on click. Content can finish before the independent directory listing,
which would open a buffer with an accidental null baseline and silently disable the mtime check.

The controller now subscribes to the existing `mountDirQueryFamily` and keeps Edit loading until
that listing resolves (`web/oss/src/components/Drives/editMode/useDriveEditController.ts:122-147`).
A genuinely omitted `mtime` still uses the plan's documented null-baseline degradation; a listing
that simply has not arrived no longer does.

## A small edit-open snapshot race remains

Edit is disabled while either the file-content query or its parent-listing query is fetching. This
closes the observed stale-content/new-mtime window, but the two queries still settle independently.
A write that lands after both fetches settle and before the buffer opens can still produce a mixed
snapshot. A fully coherent open would require the deferred listing -> content -> listing retry loop.

## Listing invalidation remains project-wide

`invalidateMountListings` now lives beside the canonical mount query keys in the non-React session
state module, so saves no longer import the upload hook dependency graph. Its behavior is unchanged:
it invalidates all active mount-listing roots in the project, not only the mount that was written.
Narrowing those keys is deferred because this pass must preserve the existing upload behavior.
