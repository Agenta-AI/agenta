/**
 * DriveItemContextMenu — the right-click menu shared by every drive item (tree rows, folder tiles,
 * file tiles) across the Build drawer and the chat Files grid. Wrapping each item in one antd
 * Dropdown (contextMenu trigger) means a new action added here — Delete, Rename, Download — lands on
 * every surface at once, instead of drifting per-surface.
 *
 * "Copy path" copies the PRESENTED path (the `agent-files/`-folded path the breadcrumb shows), the
 * same value the file-preview "Copy path" affordance copies — so folders finally get the copy
 * affordance files already had. The copy feedback rides the kit's imperative message service,
 * which renders through the app's own outlet and themes with it.
 */
import {type ReactElement, useCallback, useContext} from "react"

import {downloadMountArchive, driveDir} from "@agenta/entities/drive"
import {type SessionDriveData} from "@agenta/entities/drive"
import {createT, useT} from "@agenta/i18n"
import driveExplorerCatalog from "@agenta/i18n/catalogs/entityUi.driveExplorer"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@agenta/ui/ui"
import {
    ArrowSquareOut,
    Copy,
    DownloadSimple,
    FolderOpen,
    LinkSimple,
    PencilSimple,
    Trash,
} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {DriveLinkContext} from "./driveLink"
import {useDriveFileDownload} from "./useDriveFileDownload"

// Toasts fire from callbacks, outside render.
const tNow = createT(driveExplorerCatalog)

/** An item's write verbs; rename is file-only (no backend move endpoint). */
export interface DriveItemWriteActions {
    /** False for a mount root or an item in a read drive: its menu offers no write verb. */
    canChange: (path: string) => boolean
    onRename: (path: string) => void
    onDelete: (path: string, isFolder: boolean) => void
}

/** A `copy(text, successMessage?)` bound to the themed message toast (the kit service so it renders
 * correctly in dark mode). The generic primitive behind {@link useCopyDrivePath}; the drawer header
 * reuses it for the drive/owner ids. */
export function useCopyText(): (text: string, successMessage?: string) => void {
    return useCallback(
        (text: string, successMessage?: string) => {
            if (!text || !navigator.clipboard) return
            navigator.clipboard.writeText(text).then(
                () => void message.success(successMessage ?? tNow("entityUi.driveExplorer.copied")),
                () => void message.error(tNow("entityUi.driveExplorer.couldNotCopy")),
            )
        },
        [message],
    )
}

/** A `copyPath(path)` bound to the themed message toast — call ONCE per view and pass down to the
 * items, so thousands of virtualized tiles don't each open a message context. */
export function useCopyDrivePath(): (path: string) => void {
    const copy = useCopyText()
    return useCallback(
        (path: string) => copy(path, tNow("entityUi.driveExplorer.pathCopied")),
        [copy],
    )
}

/** The archive of a presented folder: the mount that backs it, plus every drive folded in
 * below it (the `drives/` folder holds them). The API keeps the source folder in each member path
 * (`drives/notes.md`), so each drive goes under its full folder, `drives/<slug>/`. */
export const folderArchiveMounts = (
    drive: Pick<SessionDriveData, "resolveMount" | "otherDrives">,
    path: string,
): {mountId: string; prefix: string; path: string}[] => {
    const resolved = drive.resolveMount(path)
    const out = resolved?.mount
        ? [{mountId: resolved.mount.id, prefix: "", path: resolved.path}]
        : []
    for (const other of drive.otherDrives ?? []) {
        const dir = driveDir(other.slug)
        if (path && dir.startsWith(`${path}/`))
            out.push({mountId: other.mount.id, prefix: dir, path: ""})
    }
    return out
}

/** A `download(presentedPath, isFolder)` for a drive item — a single file via the bytes endpoint, a
 * folder as a scoped zip via the streaming archive. Resolves which mount (cwd / agent-files) backs
 * the path. Call ONCE per view; pass down to the context menus (`onDownload`). Themed toast. */
export function useDriveItemDownload(
    drive: SessionDriveData,
): (path: string, isFolder: boolean) => void {
    const projectId = useAtomValue(projectIdAtom)
    const downloadFile = useDriveFileDownload()
    return useCallback(
        (path: string, isFolder: boolean) => {
            const resolved = drive.resolveMount(path)
            const mounts = isFolder ? folderArchiveMounts(drive, path) : []
            if (!resolved?.mount && !mounts.length) return
            const name = path.split("/").pop() || "download"
            const key = `drive-download:${path}`
            void (async () => {
                if (!isFolder) {
                    if (resolved?.mount) await downloadFile(resolved.mount, resolved.path)
                    return
                }
                message.open({
                    type: "loading",
                    key,
                    content: tNow("entityUi.driveExplorer.preparingDownload"),
                    duration: 0,
                })
                const result = await downloadMountArchive({
                    mounts,
                    projectId,
                    filename: `${name}.zip`,
                })
                if (result.cancelled) message.destroy(key)
                else
                    message.open(
                        result.ok
                            ? {
                                  type: "success",
                                  key,
                                  content: tNow("entityUi.driveExplorer.downloadReady"),
                              }
                            : {
                                  type: "error",
                                  key,
                                  content:
                                      result.error ?? tNow("entityUi.driveExplorer.downloadFailed"),
                              },
                    )
            })()
        },
        [drive, projectId, message, downloadFile],
    )
}

export const DriveItemContextMenu = ({
    path,
    isFolder,
    onOpen,
    onCopyPath,
    onDownload,
    writes,
    className = "min-w-0",
    children,
}: {
    /** The presented path this item stands for — copied verbatim, opened via `onOpen`. */
    path: string
    isFolder: boolean
    /** Same action the item's click performs (drill into a folder / open a file's preview). */
    onOpen: () => void
    onCopyPath: (path: string) => void
    /** Download this item (a file's bytes, or a folder as a zip). Omit → no Download entry. */
    onDownload?: (path: string, isFolder: boolean) => void
    /** Rename / delete — omit where nothing can be written. */
    writes?: DriveItemWriteActions
    /** Wrapper class — defaults to `min-w-0` so grid-cell truncation still wins; pass `w-full`
     * variants where the cell needs to stretch. */
    className?: string
    children: ReactElement | ReactElement[]
}) => {
    const t = useT(driveExplorerCatalog)
    const copyLink = useContext(DriveLinkContext)
    // The tiles/rows are themselves click targets — keep a menu click from also selecting them.
    const stop = (event: {stopPropagation: () => void}) => event.stopPropagation()

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div className={className}>{children}</div>
            </ContextMenuTrigger>
            <ContextMenuContent onClick={stop} onCloseAutoFocus={(e) => e.preventDefault()}>
                <ContextMenuItem onSelect={onOpen}>
                    {isFolder ? <FolderOpen size={14} /> : <ArrowSquareOut size={14} />}
                    {isFolder
                        ? t("entityUi.driveExplorer.openFolder")
                        : t("entityUi.driveExplorer.openFile")}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onCopyPath(path)}>
                    <Copy size={14} />
                    {t("entityUi.driveExplorer.copyPath")}
                </ContextMenuItem>
                {copyLink ? (
                    <ContextMenuItem onSelect={() => copyLink({path, isFolder})}>
                        <LinkSimple size={14} />
                        {t("entityUi.driveExplorer.copyLink")}
                    </ContextMenuItem>
                ) : null}
                {onDownload ? (
                    <ContextMenuItem onSelect={() => onDownload(path, isFolder)}>
                        <DownloadSimple size={14} />
                        {isFolder
                            ? t("entityUi.driveExplorer.downloadAsZip")
                            : t("entityUi.driveExplorer.download")}
                    </ContextMenuItem>
                ) : null}
                {writes?.canChange(path) ? (
                    <>
                        <ContextMenuSeparator />
                        {/* Folder rename needs a backend move endpoint: shown disabled. */}
                        <ContextMenuItem disabled={isFolder} onSelect={() => writes.onRename(path)}>
                            <PencilSimple size={14} />
                            {t("entityUi.driveExplorer.rename")}
                            {isFolder ? (
                                <span className="ml-auto pl-3 text-[11px] text-colorTextQuaternary">
                                    {t("entityUi.driveExplorer.filesOnly")}
                                </span>
                            ) : null}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                            onSelect={() => writes.onDelete(path, isFolder)}
                            className="text-colorError focus:text-colorError"
                        >
                            <Trash size={14} />
                            {t("entityUi.driveExplorer.delete")}
                        </ContextMenuItem>
                    </>
                ) : null}
            </ContextMenuContent>
        </ContextMenu>
    )
}
