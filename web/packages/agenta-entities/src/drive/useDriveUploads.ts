/**
 * useDriveUploads — everything about files the drive does not hold YET: the in-flight mount uploads
 * (and the synthetic tree files that let them render in place under their destination folder), the
 * drag-and-drop wiring, and the STAGED inbox (dropped on a recents peek, unwritten until a
 * destination is picked). The composition root keeps only the two selection-coupled bits — which
 * folder is "current", and committing the staged files into it — because both read the selection,
 * which is derived from the tree this hook feeds.
 *
 * Called ABOVE the tree pipeline: `uploadFiles` is an input to {@link useDriveTreeData}'s build, and
 * `pendingUploadByPath` decorates the resulting rows/tiles.
 */
import {useCallback, useEffect, useMemo, useRef} from "react"

import {type MountFile} from "@agenta/entities/session"

import {isAgentFileUploadsEnabled} from "./driveFlags"
import {type StagedTileItem} from "./driveTypes"
import {type DroppedFile} from "./dropEntries"
import {useDriveDrop} from "./useDriveDrop"
import {useImagePreviews} from "./useImagePreviews"
import {fileKey, type MountUploadItem, useMountUpload} from "./useMountUpload"
import {type SessionDriveData} from "./useSessionDrive"

const NO_FILES: DroppedFile[] = []

/** The staged tile's id — stable per position + destination path, and the handle removeStaged uses. */
const stagedId = (dropped: DroppedFile, index: number) => `${index}-${dropped.relativePath}`

export function useDriveUploads({
    drive,
    explicitFiles,
    select,
    stagedFiles,
    onStagedChange,
    onUploaded,
}: {
    drive: SessionDriveData
    /** Local-file mode — there is no mount to write to, so every upload affordance stays off. */
    explicitFiles?: MountFile[]
    /** The explorer's selection callback — a drop springs-loads into the hovered folder. */
    select: (path: string | null) => void
    stagedFiles?: DroppedFile[]
    onStagedChange?: (files: DroppedFile[]) => void
    /** One file's write landed, at its presented path — see {@link useUploadReveal}. */
    onUploaded?: (path: string) => void
}) {
    // Upload state lives here (above the tree) so in-flight uploads can be injected as synthetic files —
    // buildDriveTree then nests each UNDER its destination folder, and the real tree row / file tile
    // renders it in place (decorated via pendingUploadByPath), rather than a separate pinned list.
    const mountUpload = useMountUpload(onUploaded)
    const uploadPath = useCallback(
        (it: MountUploadItem) =>
            it.presentedFolder ? `${it.presentedFolder}/${it.relativePath}` : it.relativePath,
        [],
    )
    const uploadFiles = useMemo<MountFile[]>(
        () =>
            mountUpload.items.map(
                (it) => ({path: uploadPath(it), size: it.size}) as unknown as MountFile,
            ),
        [mountUpload.items, uploadPath],
    )

    // Upload files INTO the current folder — mount-backed, writable hosts only (never the local-file
    // preview, which has no mount to write to). `mountUpload` is declared above the tree build.
    // The single switch for every upload affordance here: header button, drop-to-upload on folders
    // and panes, and the staged-files inbox.
    const uploadInputRef = useRef<HTMLInputElement>(null)
    const canUpload = isAgentFileUploadsEnabled() && !explicitFiles && !!drive.mount
    const uploadIntoFolder = useCallback(
        (picked: DroppedFile[], folder: string) => {
            const resolved = drive.resolveMount(folder)
            if (!resolved) return
            mountUpload.upload(picked, {
                mount: resolved.mount,
                destFolder: resolved.path,
                presentedFolder: folder,
            })
            // A file that was staged and is now uploading must not show as BOTH — drop any staged
            // copy (same key) from the inbox so the two flows never duplicate an item.
            if (onStagedChange && stagedFiles?.length) {
                const keys = new Set(picked.map(fileKey))
                const remaining = stagedFiles.filter((f) => !keys.has(fileKey(f)))
                if (remaining.length !== stagedFiles.length) onStagedChange(remaining)
            }
        },
        [drive, mountUpload, stagedFiles, onStagedChange],
    )
    // Drag-and-drop uploads: highlight + spring-load into folders, drop to upload. Disabled in the
    // local-file preview (no mount to write to).
    const drop = useDriveDrop({
        enabled: canUpload,
        onUpload: canUpload ? uploadIntoFolder : () => {},
        onNavigate: select,
    })

    // Staged uploads: files dropped on a recents peek, held UNWRITTEN until the user navigates to a
    // destination and clicks "Upload here" — ghost tiles in the grid meanwhile. Only for writable
    // mounts (never the local-file preview). Image previews come from the shared hook.
    const staged = canUpload ? (stagedFiles ?? NO_FILES) : NO_FILES
    const stagedPreviews = useImagePreviews(useMemo(() => staged.map((d) => d.file), [staged]))
    const stagedItems = useMemo<StagedTileItem[]>(
        () =>
            staged.map((d, i) => ({
                id: stagedId(d, i),
                name: d.file.name,
                file: d.file,
                previewUrl: stagedPreviews.get(d.file) ?? null,
            })),
        [staged, stagedPreviews],
    )
    const removeStaged = useCallback(
        (id: string) => onStagedChange?.(staged.filter((d, i) => stagedId(d, i) !== id)),
        [staged, onStagedChange],
    )
    // Single source of truth: a file that is in-flight (uploading OR failed) must never ALSO remain
    // staged. Reconcile the staged inbox against in-flight keys on every change, so re-staging a file
    // that already failed — or any race the one-shot prune misses — can't render the same file twice.
    useEffect(() => {
        if (!onStagedChange || !stagedFiles?.length) return
        const inFlight = new Set(mountUpload.items.map((it) => it.key))
        const remaining = stagedFiles.filter((f) => !inFlight.has(fileKey(f)))
        if (remaining.length !== stagedFiles.length) onStagedChange(remaining)
    }, [stagedFiles, mountUpload.items, onStagedChange])
    // The injected upload nodes (see uploadFiles above) are decorated by path with their live status.
    const pendingUploadByPath = useMemo(
        () => new Map(mountUpload.items.map((it) => [uploadPath(it), it])),
        [mountUpload.items, uploadPath],
    )

    return {
        canUpload,
        uploadInputRef,
        /** In-flight uploads as synthetic tree files — fold these into the tree build. */
        uploadFiles,
        pendingUploadByPath,
        uploadIntoFolder,
        drop,
        staged,
        stagedItems,
        removeStaged,
        retryUpload: mountUpload.retry,
        dismissUpload: mountUpload.dismiss,
    }
}
