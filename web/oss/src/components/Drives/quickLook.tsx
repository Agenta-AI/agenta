/**
 * Quick Look — the chat-mode centered file preview (build-spec view E, "Quick Look" column).
 * No drawer, no route change: click a tile / in-thread file card → a centered modal with name ·
 * meta · content · Download, ◂ ▸ paging over the drive's recency-ordered files (arrow keys),
 * esc closes. Same renderer as the Build drawer preview (DriveFileContentViewer).
 *
 * The request atom carries only the PATH: the host (mounted once per conversation, which knows
 * the active session) resolves it against the drive — so tiles and in-thread cards can open a
 * file without threading session context.
 */
import {useEffect, useMemo} from "react"

import {CaretLeft, CaretRight} from "@phosphor-icons/react"
import {Button, Modal} from "antd"
import {atom, useAtom} from "jotai"

import {DriveFileContentViewer, DriveFileDownloadButton, driveFileIcon} from "./DriveDrawer"
import {humanSize, relativeTime} from "./driveTree"
import {useSessionDrive} from "./useSessionDrive"

/** Open Quick Look on a drive file (path is drive-root-relative OR a tool path tail). */
export const driveQuickLookAtom = atom<{path: string} | null>(null)

const matchesTail = (filePath: string, requested: string): boolean =>
    filePath === requested || requested.endsWith(`/${filePath}`)

export function DriveQuickLook({sessionId}: {sessionId: string}) {
    const [request, setRequest] = useAtom(driveQuickLookAtom)
    const drive = useSessionDrive(request ? sessionId : "")

    const files = drive.recents
    const index = useMemo(
        () => (request ? files.findIndex((f) => matchesTail(f.path, request.path)) : -1),
        [request, files],
    )
    const file = index >= 0 ? files[index] : null

    const page = (delta: number) => {
        if (!files.length) return
        const next = files[(Math.max(index, 0) + delta + files.length) % files.length]
        setRequest({path: next.path})
    }

    // Arrow-key paging while open (esc close is the Modal default).
    useEffect(() => {
        if (!request) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") page(-1)
            if (e.key === "ArrowRight") page(1)
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [request, index, files])

    const name = file?.path.split("/").pop() ?? request?.path.split("/").pop() ?? ""
    const folder = file?.path.includes("/") ? file.path.split("/").slice(0, -1).join("/") : null

    return (
        <Modal
            open={Boolean(request)}
            onCancel={() => setRequest(null)}
            footer={null}
            width={640}
            centered
            destroyOnHidden
        >
            <div className="flex min-h-0 flex-col gap-2 pt-1">
                <div className="flex items-start justify-between gap-2 pr-6">
                    <div className="flex min-w-0 items-center gap-2">
                        {file ? driveFileIcon(file.path, 18) : null}
                        <div className="min-w-0">
                            <div className="truncate font-mono text-[13px] font-semibold">
                                {name}
                            </div>
                            <div className="text-[11px] text-colorTextTertiary">
                                {folder ? <>{folder} · </> : null}
                                {file ? humanSize(file.size) : null}
                                {file?.touchedAt ? <> · {relativeTime(file.touchedAt)}</> : null}
                            </div>
                        </div>
                    </div>
                    {file ? <DriveFileDownloadButton mount={drive.mount} path={file.path} /> : null}
                </div>

                <div className="flex max-h-[60vh] min-h-[200px] flex-col overflow-hidden">
                    {file ? (
                        <DriveFileContentViewer mount={drive.mount} path={file.path} />
                    ) : (
                        <div className="flex flex-1 items-center justify-center text-xs text-colorTextTertiary">
                            {drive.isLoading ? "Loading…" : "This file isn't in the drive yet."}
                        </div>
                    )}
                </div>

                {files.length > 1 ? (
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
                ) : null}
            </div>
        </Modal>
    )
}
