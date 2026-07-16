/**
 * FilesDrawerBody — the heavy body of the chat Files drawer: the FilesWindow grid (thumbnails,
 * renderers) plus the sliding single-file preview. Its OWN module so {@link FilesDrawer} can
 * `next/dynamic`-import it — the grid/renderer/pdfjs graph then loads only when the drawer opens,
 * not with the always-mounted per-session chat pane, and unmounts on close (`destroyOnClose`).
 */
import {AnimatePresence, motion} from "motion/react"

import {SESSION_SPRING} from "@/oss/components/AgentChatSlice/assets/sessionMotion"

import {DriveFileContentViewer} from "./DriveExplorer"
import {DriveFileMetaList} from "./fileMeta"
import FilesWindow from "./FilesWindow"
import {type DriveRecentFile, type ResolvedMountPath} from "./useSessionDrive"

export default function FilesDrawerBody({
    sessionId,
    inPreview,
    file,
    resolvedFile,
    buildMode,
    metaExpanded,
    isLoading,
}: {
    sessionId: string
    inPreview: boolean
    /** The previewed file (null when the requested path isn't in the drive yet). */
    file: DriveRecentFile | null
    /** Which mount backs the previewed file + its mount-relative path (for content/download). */
    resolvedFile: ResolvedMountPath | null
    /** Build mode shows the metadata; chat mode stays content-first. */
    buildMode: boolean
    /** Whether the metadata grid is expanded — the toggle lives in the drawer header. */
    metaExpanded: boolean
    isLoading: boolean
}) {
    return (
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
                                        mount={resolvedFile?.mount ?? null}
                                        path={resolvedFile?.path ?? file.path}
                                        size={file.size}
                                        touchedAt={file.touchedAt}
                                        expanded={metaExpanded}
                                    />
                                ) : null}
                                <DriveFileContentViewer
                                    mount={resolvedFile?.mount ?? null}
                                    path={resolvedFile?.path ?? file.path}
                                    size={file.size}
                                />
                            </div>
                        ) : (
                            <div className="flex flex-1 items-center justify-center p-6 text-xs text-colorTextTertiary">
                                {isLoading ? "Loading…" : "This file isn't in the drive yet."}
                            </div>
                        )}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    )
}
