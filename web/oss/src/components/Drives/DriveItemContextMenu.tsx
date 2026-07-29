/**
 * DriveItemContextMenu — the right-click menu shared by every drive item (tree rows, folder tiles,
 * file tiles) across the Build drawer and the chat Files grid. Wrapping each item in one antd
 * Dropdown (contextMenu trigger) means a new action added here — Delete, Rename, Download — lands on
 * every surface at once, instead of drifting per-surface.
 *
 * "Copy path" copies the PRESENTED path (the `agent-files/`-folded path the breadcrumb shows), the
 * same value the file-preview "Copy path" affordance copies — so folders finally get the copy
 * affordance files already had. The copy feedback rides `App.useApp()`'s message so it themes
 * correctly in dark mode (a static `message.*` would render light — see the dark-mode notes).
 */
import {type ReactElement, useCallback, useMemo} from "react"

import {ArrowSquareOut, Copy, DownloadSimple, FolderOpen} from "@phosphor-icons/react"
import {App, Dropdown, type MenuProps} from "antd"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {downloadMountArchive, downloadMountFile} from "./driveMedia"
import {type SessionDriveData} from "./useSessionDrive"

/** A `copy(text, successMessage?)` bound to the themed message toast (App.useApp so it renders
 * correctly in dark mode). The generic primitive behind {@link useCopyDrivePath}; the drawer header
 * reuses it for the drive/owner ids. */
export function useCopyText(): (text: string, successMessage?: string) => void {
    const {message} = App.useApp()
    return useCallback(
        (text: string, successMessage = "Copied") => {
            if (!text || !navigator.clipboard) return
            navigator.clipboard.writeText(text).then(
                () => void message.success(successMessage),
                () => void message.error("Couldn't copy"),
            )
        },
        [message],
    )
}

/** A `copyPath(path)` bound to the themed message toast — call ONCE per view and pass down to the
 * items, so thousands of virtualized tiles don't each open a message context. */
export function useCopyDrivePath(): (path: string) => void {
    const copy = useCopyText()
    return useCallback((path: string) => copy(path, "Path copied"), [copy])
}

/** A `download(presentedPath, isFolder)` for a drive item — a single file via the bytes endpoint, a
 * folder as a scoped zip via the streaming archive. Resolves which mount (cwd / agent-files) backs
 * the path. Call ONCE per view; pass down to the context menus (`onDownload`). Themed toast. */
export function useDriveItemDownload(
    drive: SessionDriveData,
): (path: string, isFolder: boolean) => void {
    const {message} = App.useApp()
    const projectId = useAtomValue(projectIdAtom)
    return useCallback(
        (path: string, isFolder: boolean) => {
            const resolved = drive.resolveMount(path)
            if (!resolved?.mount) return
            const name = path.split("/").pop() || "download"
            const key = `drive-download:${path}`
            void (async () => {
                if (!isFolder) {
                    message.open({type: "loading", key, content: "Downloading…", duration: 0})
                    const ok = await downloadMountFile({
                        mount: resolved.mount,
                        path: resolved.path,
                        projectId,
                    })
                    message.open(
                        ok
                            ? {type: "success", key, content: "Downloaded"}
                            : {type: "error", key, content: "Download failed"},
                    )
                    return
                }
                message.open({type: "loading", key, content: "Preparing download…", duration: 0})
                const result = await downloadMountArchive({
                    mounts: [{mountId: resolved.mount.id, prefix: "", path: resolved.path}],
                    projectId,
                    filename: `${name}.zip`,
                })
                if (result.cancelled) message.destroy(key)
                else
                    message.open(
                        result.ok
                            ? {type: "success", key, content: "Download ready"}
                            : {type: "error", key, content: result.error ?? "Download failed"},
                    )
            })()
        },
        [drive, projectId, message],
    )
}

export const DriveItemContextMenu = ({
    path,
    isFolder,
    onOpen,
    onCopyPath,
    onDownload,
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
    /** Wrapper class — defaults to `min-w-0` so grid-cell truncation still wins; pass `w-full`
     * variants where the cell needs to stretch. */
    className?: string
    children: ReactElement | ReactElement[]
}) => {
    const items = useMemo<MenuProps["items"]>(() => {
        const list: NonNullable<MenuProps["items"]> = [
            {
                key: "open",
                label: isFolder ? "Open folder" : "Open file",
                icon: isFolder ? <FolderOpen size={14} /> : <ArrowSquareOut size={14} />,
            },
            {key: "copy", label: "Copy path", icon: <Copy size={14} />},
        ]
        if (onDownload) {
            list.push({
                key: "download",
                label: isFolder ? "Download as zip" : "Download",
                icon: <DownloadSimple size={14} />,
            })
        }
        return list
    }, [isFolder, onDownload])
    const onClick: NonNullable<MenuProps["onClick"]> = ({key, domEvent}) => {
        // The tiles/rows are themselves click targets — keep a menu click from also selecting them.
        domEvent.stopPropagation()
        if (key === "open") onOpen()
        else if (key === "copy") onCopyPath(path)
        else if (key === "download") onDownload?.(path, isFolder)
    }
    return (
        <Dropdown trigger={["contextMenu"]} menu={{items, onClick}}>
            <div className={className}>{children}</div>
        </Dropdown>
    )
}
