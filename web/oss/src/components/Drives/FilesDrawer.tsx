/**
 * FilesDrawer — the chat-mode Files surface as ONE right drawer with two states that transition
 * in place (no drawer-on-drawer stacking):
 *   grid  — the FilesWindow (grid / list, search + sort). A tile opens a file.
 *   preview — a single file's content (the same renderer the Build drawer uses), with ◂ ▸ paging.
 *
 * A THIN wrapper: it holds only the open-state atoms + light drawer chrome (title/footer), and
 * `next/dynamic`-imports the heavy {@link FilesDrawerBody} (grid renderers + preview) so that graph
 * loads only when the drawer opens and unmounts on close (`destroyOnClose`). The drive query is
 * gated on `open`, so the always-mounted per-session host does no heavy work while closed.
 *
 * Every opener — tiles, in-thread cards, rail rows, chat links — just sets this session's
 * `driveQuickLookAtomFamily` slot (the file to preview); that also opens the drawer, so a chat link
 * jumps straight to the file and Back reveals the grid behind it. Chat mode is jargon-free and
 * content-first: NO metadata block here (that lives in the Build drawer).
 */
import {useEffect, useState} from "react"

import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ArrowLeft, CaretLeft, CaretRight, DownloadSimple, FolderSimple} from "@phosphor-icons/react"
import {Button, Skeleton} from "antd"
import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import dynamic from "next/dynamic"

import {chatPanelMaximizedAtom} from "@/oss/components/AgentChatSlice/state/panelLayout"
import {projectIdAtom} from "@/oss/state/project"

import {driveFileIcon} from "./driveIcons"
import {downloadMountFile} from "./driveMedia"
import {useDriveArtifactId} from "./driveSessionContext"
import {humanSize, relativeTime} from "./driveTree"
import {driveQuickLookAtomFamily} from "./quickLook"
import {useSessionDrive} from "./useSessionDrive"

// Heavy grid + preview — loaded lazily on first open, not with the always-mounted chat pane.
const FilesDrawerBody = dynamic(() => import("./FilesDrawerBody"), {
    ssr: false,
    loading: () => (
        <div className="min-h-0 flex-1 p-3">
            <Skeleton active paragraph={{rows: 6}} />
        </div>
    ),
})

// Keyed by session id — every mounted pane has its own FilesDrawer host, so a shared open flag
// would leak the drawer's open state across sessions on a tab switch.
export const filesDrawerOpenAtomFamily = atomFamily((_sessionId: string) => atom(false))

const matchesTail = (filePath: string, requested: string): boolean =>
    filePath === requested || requested.endsWith(`/${filePath}`)

export function FilesDrawer({sessionId}: {sessionId: string}) {
    const [gridOpen, setGridOpen] = useAtom(filesDrawerOpenAtomFamily(sessionId))
    const [quickLook, setQuickLook] = useAtom(driveQuickLookAtomFamily(sessionId))
    // Build mode gets the full metadata block; chat mode stays content-first (jargon-free).
    const buildMode = !useAtomValue(chatPanelMaximizedAtom)
    const projectId = useAtomValue(projectIdAtom)
    // Metadata grid visibility — the toggle lives in the drawer header, the grid renders in the body.
    const [metaExpanded, setMetaExpanded] = useState(false)
    const open = gridOpen || quickLook != null
    const inPreview = quickLook != null

    const artifactId = useDriveArtifactId()
    // Gate BOTH ids on `open`: the agent-mount query keys on artifactId (not sessionId), so passing
    // a live artifactId while closed would fetch the agent drive before the drawer is ever shown.
    const drive = useSessionDrive(
        open ? sessionId : "",
        open ? (artifactId ?? undefined) : undefined,
    )
    const files = drive.recents
    const index = inPreview ? files.findIndex((f) => matchesTail(f.path, quickLook.path)) : -1
    const file = index >= 0 ? files[index] : null
    // A previewed file may live in the cwd mount or the nested agent-files mount — resolve which,
    // and its path relative to that mount, for the content viewer + download.
    const resolvedFile = file ? drive.resolveMount(file.path) : null

    const page = (delta: number) => {
        if (!files.length) return
        const next = files[(Math.max(index, 0) + delta + files.length) % files.length]
        setQuickLook({path: next.path})
    }

    // A preview request opens the drawer AND keeps the grid "open" beneath it, so Back reveals it.
    useEffect(() => {
        if (quickLook && !gridOpen) setGridOpen(true)
    }, [quickLook, gridOpen, setGridOpen])

    // Arrow-key paging while previewing.
    useEffect(() => {
        if (!inPreview) return
        const onKey = (e: KeyboardEvent) => {
            // The grid (with its search box) stays mounted behind the preview; don't steal Left/Right
            // from a focused text field, where they move the caret.
            const target = e.target as HTMLElement | null
            if (
                target?.isContentEditable ||
                /^(input|textarea|select)$/i.test(target?.tagName ?? "")
            )
                return
            if (e.key === "ArrowLeft") page(-1)
            if (e.key === "ArrowRight") page(1)
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [inPreview, index, files])

    const back = () => setQuickLook(null)
    const close = () => {
        setQuickLook(null)
        setGridOpen(false)
    }

    const name = file?.path.split("/").pop() ?? quickLook?.path.split("/").pop() ?? ""
    const folder = file?.path.includes("/") ? file.path.split("/").slice(0, -1).join("/") : null

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={close}
            placement="right"
            width={720}
            destroyOnClose
            closeOnLayoutClick={false}
            title={
                inPreview ? (
                    <div className="flex min-w-0 items-center gap-1.5">
                        <Button
                            type="text"
                            size="small"
                            aria-label="Back to files"
                            icon={<ArrowLeft size={16} />}
                            onClick={back}
                            className="!h-7 !w-7 !min-w-0 shrink-0 !p-0"
                        />
                        <span className="shrink-0">
                            {file ? driveFileIcon(file.path, 16) : null}
                        </span>
                        <div className="min-w-0">
                            <div className="truncate font-mono text-sm font-medium">{name}</div>
                            <div className="truncate text-xs font-normal text-colorTextTertiary">
                                {folder ? <>{folder} · </> : null}
                                {file ? humanSize(file.size) : null}
                                {file?.touchedAt ? <> · {relativeTime(file.touchedAt)}</> : null}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex min-w-0 items-center gap-2">
                        <FolderSimple size={16} className="shrink-0 text-colorTextSecondary" />
                        <div className="min-w-0">
                            <div className="truncate text-sm font-medium">Files</div>
                            <div className="truncate text-xs font-normal text-colorTextTertiary">
                                {drive.fileCount} file{drive.fileCount === 1 ? "" : "s"} ·{" "}
                                {humanSize(drive.totalSize) || "0 B"} · this conversation
                            </div>
                        </div>
                    </div>
                )
            }
            extra={
                inPreview && file ? (
                    <div className="flex items-center gap-1.5">
                        {/* Details toggle in the header (not a duplicate meta line in the body): the
                            header already shows name · size · time, so the toggle just reveals the
                            full grid below. */}
                        {buildMode ? (
                            <Button
                                type="text"
                                size="small"
                                aria-expanded={metaExpanded}
                                onClick={() => setMetaExpanded((v) => !v)}
                                className="!text-colorTextTertiary hover:!text-colorText"
                            >
                                Details
                                <CaretRight
                                    size={11}
                                    className={`ml-0.5 transition-transform ${metaExpanded ? "rotate-90" : ""}`}
                                />
                            </Button>
                        ) : null}
                        <Button
                            icon={<DownloadSimple size={13} />}
                            disabled={!resolvedFile?.mount && !drive.mount}
                            onClick={() =>
                                void downloadMountFile({
                                    mount: resolvedFile?.mount ?? null,
                                    path: resolvedFile?.path ?? file.path,
                                    projectId,
                                })
                            }
                        >
                            Download
                        </Button>
                    </div>
                ) : undefined
            }
            footer={
                inPreview && files.length > 1 ? (
                    <div className="flex items-center justify-between text-[11px] text-colorTextTertiary">
                        <Button
                            type="text"
                            icon={<CaretLeft size={13} />}
                            onClick={() => page(-1)}
                            aria-label="Previous file"
                        />
                        <span>
                            {Math.max(index, 0) + 1} of {files.length}
                        </span>
                        <Button
                            type="text"
                            icon={<CaretRight size={13} />}
                            onClick={() => page(1)}
                            aria-label="Next file"
                        />
                    </div>
                ) : undefined
            }
            styles={{body: {padding: 0, display: "flex", minHeight: 0}}}
        >
            <FilesDrawerBody
                sessionId={sessionId}
                inPreview={inPreview}
                file={file}
                resolvedFile={resolvedFile}
                buildMode={buildMode}
                metaExpanded={metaExpanded}
                isLoading={drive.isLoading}
            />
        </EnhancedDrawer>
    )
}
