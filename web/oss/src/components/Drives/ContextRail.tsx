/**
 * ContextRail — the chat-mode right context rail (build-spec v2, view E1): the one structural
 * change to Chat. Collapsible (~300px ↔ slim strip, persisted); Files pinned at the top —
 * 4 most-recent files + count + "View all files" — above the lighter Context and Progress
 * sections. Jargon-free (never mount/cwd/drive). Reuses the Build recents via the shared
 * drive atoms — no new fetch; a file row opens Quick Look, "View all files" opens the Files
 * window (the right panel's Files tab).
 */
import {ArrowSquareOut, CaretRight, FolderSimple, Sidebar} from "@phosphor-icons/react"
import {Button, Tag, Tooltip, Typography} from "antd"
import {useAtom, useSetAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {isSessionFresh} from "@/oss/components/AgentChatSlice/state/sessionEphemera"

import {driveFileIcon} from "./DriveDrawer"
import {relativeTime} from "./driveTree"
import {driveQuickLookAtom} from "./quickLook"
import {useSessionDrive} from "./useSessionDrive"

const {Text} = Typography

/** Rail visibility — a global UI preference (survives session switches and reloads).
 * Starts CLOSED; opening it once is the opt-in. */
export const contextRailOpenAtom = atomWithStorage<boolean>("agenta:agent-chat:context-rail", false)

const SectionLabel = ({children}: {children: React.ReactNode}) => (
    <div className="px-3 pb-1 pt-3 text-xs font-medium text-colorTextSecondary">{children}</div>
)

// Same slide the right panel uses (RightPanelSplit) so the two right-edge elements move alike.
const SLIDE_CLASS = "[transition:width_220ms_ease]"
const RAIL_WIDTH = 300
const STRIP_WIDTH = 36

export function ContextRail({
    sessionId,
    busy,
    hidden = false,
    onOpenFiles,
}: {
    sessionId: string
    /** The conversation is currently running a turn (drives the Progress line). */
    busy?: boolean
    /** Slide the rail away entirely (build mode / the Turn-Session panel owns the right edge).
     * The component stays MOUNTED so the width change animates instead of popping. */
    hidden?: boolean
    /** Open the Files window (the right panel's Files tab). */
    onOpenFiles: () => void
}) {
    const [open, setOpen] = useAtom(contextRailOpenAtom)
    // A brand-new never-run tab has no server data — hold the queries off until its first run.
    const drive = useSessionDrive(isSessionFresh(sessionId) ? "" : sessionId)
    const openQuickLook = useSetAtom(driveQuickLookAtom)

    const width = hidden ? 0 : open ? RAIL_WIDTH : STRIP_WIDTH

    return (
        <div
            className={`shrink-0 overflow-hidden ${SLIDE_CLASS}`}
            style={{width}}
            aria-hidden={hidden}
        >
            {!open ? (
                <div
                    className="flex h-full flex-col items-center border-0 border-l border-solid border-[var(--ag-surface-divider)] px-0.5 pt-2"
                    style={{width: STRIP_WIDTH}}
                >
                    <Tooltip title="Show context rail" placement="left">
                        <Button
                            type="text"
                            icon={<Sidebar size={15} />}
                            onClick={() => setOpen(true)}
                            aria-label="Show context rail"
                        />
                    </Tooltip>
                </div>
            ) : (
                <ExpandedRail
                    drive={drive}
                    busy={busy}
                    onOpenFiles={onOpenFiles}
                    onCollapse={() => setOpen(false)}
                    onQuickLook={(path) => openQuickLook({path})}
                />
            )}
        </div>
    )
}

const ExpandedRail = ({
    drive,
    busy,
    onOpenFiles,
    onCollapse,
    onQuickLook,
}: {
    drive: ReturnType<typeof useSessionDrive>
    busy?: boolean
    onOpenFiles: () => void
    onCollapse: () => void
    onQuickLook: (path: string) => void
}) => {
    return (
        <aside
            className="flex h-full flex-col overflow-y-auto border-0 border-l border-solid border-[var(--ag-surface-divider)]"
            style={{width: RAIL_WIDTH}}
        >
            {/* Files — pinned at the top. */}
            <div className="flex items-center gap-1.5 px-3 pt-3">
                <span className="text-xs font-medium">Files</span>
                {drive.fileCount > 0 ? (
                    <Tag bordered className="m-0 !px-1.5 !text-[10px] font-normal leading-[16px]">
                        {drive.fileCount}
                    </Tag>
                ) : null}
                <div className="ml-auto flex items-center">
                    <Tooltip title="Open the Files window">
                        <Button
                            type="text"
                            icon={<ArrowSquareOut size={13} />}
                            onClick={onOpenFiles}
                            aria-label="Open the Files window"
                        />
                    </Tooltip>
                    <Tooltip title="Hide context rail">
                        <Button
                            type="text"
                            icon={<Sidebar size={13} />}
                            onClick={onCollapse}
                            aria-label="Hide context rail"
                        />
                    </Tooltip>
                </div>
            </div>
            <div className="flex flex-col px-2 pb-1">
                {drive.fileCount === 0 ? (
                    <Text type="secondary" className="px-1 pb-1 !text-[11px]">
                        {drive.isLoading ? "Loading…" : "No files yet."}
                    </Text>
                ) : (
                    <>
                        {drive.recents.slice(0, 4).map((file) => (
                            <button
                                key={file.path}
                                type="button"
                                onClick={() => onQuickLook(file.path)}
                                className="flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-1.5 py-1 text-left transition-colors hover:bg-colorFillTertiary"
                            >
                                <span className="shrink-0">{driveFileIcon(file.path)}</span>
                                <span className="min-w-0 truncate font-mono text-xs">
                                    {file.path.split("/").pop()}
                                </span>
                                {file.touchedAt ? (
                                    <span className="ml-auto shrink-0 text-[11px] text-colorTextQuaternary">
                                        {relativeTime(file.touchedAt).replace(" ago", "")}
                                    </span>
                                ) : null}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={onOpenFiles}
                            className="mt-0.5 w-fit cursor-pointer rounded border-0 bg-transparent px-1.5 py-0.5 text-xs text-[var(--ag-colorInfo)] hover:underline"
                        >
                            View all files
                        </button>
                    </>
                )}
            </div>

            {/* Context — lighter section (static in phase 1). */}
            <div className="mx-3 border-0 border-t border-solid border-[var(--ag-surface-divider)]" />
            <SectionLabel>Context</SectionLabel>
            <div className="flex items-center gap-2 px-4 pb-2">
                <FolderSimple size={13} className="shrink-0 text-colorWarning" />
                <Text type="secondary" className="!text-xs">
                    This conversation
                </Text>
            </div>

            {/* Progress — placeholder line tied to the live run state. */}
            <div className="mx-3 border-0 border-t border-solid border-[var(--ag-surface-divider)]" />
            <div className="flex items-center gap-1.5 px-3 pb-3 pt-3">
                <span className="text-xs font-medium">Progress</span>
                <Text type="secondary" className="!text-[11px]">
                    {busy ? "running…" : "idle"}
                </Text>
                <CaretRight size={11} className="ml-auto shrink-0 text-colorTextQuaternary" />
            </div>
        </aside>
    )
}
