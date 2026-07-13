/**
 * FilesDrawer — the chat-mode Files surface as ONE right drawer with two states that transition
 * in place (no drawer-on-drawer stacking):
 *   grid  — the FilesWindow (grid / list, search + sort). A tile opens a file.
 *   preview — a single file's content (the same renderer the Build drawer uses), with ◂ ▸ paging.
 *
 * The grid stays mounted (scroll preserved); the preview slides OVER it and back, so exiting is a
 * single close from either state (the old stack needed two). Every opener — tiles, in-thread
 * cards, rail rows, chat links — just sets this session's `driveQuickLookAtomFamily` slot (the file
 * to preview); that also
 * opens the drawer, so a chat link jumps straight to the file and Back reveals the grid behind it.
 *
 * Chat mode is jargon-free and content-first: NO metadata block here (that lives in the Build
 * drawer) — the header carries name · size · time and the body is the file itself.
 */
import {useEffect} from "react"

import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ArrowLeft, CaretLeft, CaretRight, FolderSimple} from "@phosphor-icons/react"
import {Button} from "antd"
import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {AnimatePresence, motion} from "motion/react"

import {SESSION_SPRING} from "@/oss/components/AgentChatSlice/assets/sessionMotion"
import {chatPanelMaximizedAtom} from "@/oss/components/AgentChatSlice/state/panelLayout"

import {DriveFileContentViewer, DriveFileDownloadButton, driveFileIcon} from "./DriveDrawer"
import {humanSize, relativeTime} from "./driveTree"
import {DriveFileMetaList} from "./fileMeta"
import FilesWindow from "./FilesWindow"
import {driveQuickLookAtomFamily} from "./quickLook"
import {useSessionDrive} from "./useSessionDrive"

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
    const open = gridOpen || quickLook != null
    const inPreview = quickLook != null

    const drive = useSessionDrive(open ? sessionId : "")
    const files = drive.recents
    const index = inPreview ? files.findIndex((f) => matchesTail(f.path, quickLook.path)) : -1
    const file = index >= 0 ? files[index] : null

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
                    <DriveFileDownloadButton mount={drive.mount} path={file.path} />
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
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
                {/* Grid stays mounted so its scroll survives a preview round-trip. */}
                <div className="absolute inset-0 flex min-h-0 flex-col">
                    <FilesWindow sessionId={sessionId} embedded />
                </div>
                {/* initial={false}: a direct link-open lands ON the preview (no grid flash); a
                    grid→preview navigation within the open drawer still slides. */}
                <AnimatePresence initial={false}>
                    {inPreview ? (
                        <motion.div
                            key="preview"
                            className="absolute inset-0 flex min-h-0 flex-col bg-colorBgElevated"
                            initial={{x: "100%"}}
                            animate={{x: 0}}
                            exit={{x: "100%"}}
                            transition={SESSION_SPRING}
                        >
                            {file ? (
                                <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                                    {buildMode ? (
                                        <DriveFileMetaList
                                            mount={drive.mount}
                                            path={file.path}
                                            size={file.size}
                                            touchedAt={file.touchedAt}
                                        />
                                    ) : null}
                                    <DriveFileContentViewer
                                        mount={drive.mount}
                                        path={file.path}
                                        size={file.size}
                                    />
                                </div>
                            ) : (
                                <div className="flex flex-1 items-center justify-center p-6 text-xs text-colorTextTertiary">
                                    {drive.isLoading
                                        ? "Loading…"
                                        : "This file isn't in the drive yet."}
                                </div>
                            )}
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>
        </EnhancedDrawer>
    )
}
