/**
 * ContextRail — the chat-mode right context rail (build-spec v2, view E1). Collapsible
 * (~300px ↔ slim strip, persisted). Shows the conversation's Files — recents + count +
 * "View all files". Jargon-free (never mount/cwd/drive); reuses the shared drive atoms (no new
 * fetch). Uses the same elevated dark surface as the build-mode Inspector so the right dock reads
 * as one panel across modes. A file row opens Quick Look; "View all files" opens the Files drawer.
 */
import {ArrowSquareOut, FolderSimple, Sidebar} from "@phosphor-icons/react"
import {Button, Tag, Tooltip, Typography} from "antd"
import {useAtom, useSetAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {isSessionFresh} from "@/oss/components/AgentChatSlice/state/sessionEphemera"

import {DriveFileRow} from "./DriveFileRow"
import {FILE_ITEM_VARIANTS, FILE_SPRING} from "./driveMotion"
import {useDriveArtifactId} from "./driveSessionContext"
import {relativeTime} from "./driveTree"
import {driveQuickLookAtomFamily} from "./quickLook"
import {isRecentlyChanged, useRecentChangeClock} from "./recentChange"
import {driveHasMixedOrigins, useSessionDrive} from "./useSessionDrive"

const {Text} = Typography

// Shared elevated surface with the Inspector (build-spec §elevation) — the right dock reads the
// same in chat (this rail) and build (Inspector). Theme-aware tokens, same as the Inspector panel.
const SURFACE = "var(--ag-surface-raised)"
const BORDER = "var(--ag-colorSplit)"

/** Rail visibility — a global UI preference (survives session switches and reloads).
 * Starts CLOSED; opening it once is the opt-in. */
export const contextRailOpenAtom = atomWithStorage<boolean>("agenta:agent-chat:context-rail", false)

// The playground's canonical pane ease (globals.css `.playground-splitter-animated`) — the
// rail, the right panel, and the config pane must all move on ONE curve or the transcript
// visibly wobbles between them.
const SLIDE_CLASS = "[transition:width_240ms_cubic-bezier(0.4,0,0.2,1)]"
const RAIL_WIDTH = 300
const STRIP_WIDTH = 36

export function ContextRail({
    sessionId,
    busy,
    hidden = false,
    onOpenFiles,
}: {
    sessionId: string
    /** The conversation is currently running a turn (drives the running indicator). */
    busy?: boolean
    /** Slide the rail away entirely (build mode / the Inspector owns the right edge). The
     * component stays MOUNTED so the width change animates instead of popping. */
    hidden?: boolean
    /** Open the Files drawer. */
    onOpenFiles: () => void
}) {
    const [open, setOpen] = useAtom(contextRailOpenAtom)
    // A brand-new never-run tab has no server data — hold the queries off until its first run.
    const artifactId = useDriveArtifactId()
    const drive = useSessionDrive(
        isSessionFresh(sessionId) ? "" : sessionId,
        artifactId ?? undefined,
    )
    const openQuickLook = useSetAtom(driveQuickLookAtomFamily(sessionId))

    const width = hidden ? 0 : open ? RAIL_WIDTH : STRIP_WIDTH

    return (
        <div
            className={`shrink-0 overflow-hidden ${SLIDE_CLASS}`}
            style={{width, background: SURFACE}}
            aria-hidden={hidden}
        >
            {!open ? (
                // The whole strip is one hover-able click target; per-icon tooltips + the file
                // COUNT badge announce there's content behind it (discoverability).
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpen(true)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            setOpen(true)
                        }
                    }}
                    aria-label="Show files"
                    className="group flex h-full cursor-pointer flex-col items-center gap-2.5 border-0 border-l border-solid pt-3 transition-colors hover:bg-[var(--ag-colorFillTertiary)]"
                    style={{width: STRIP_WIDTH, borderColor: BORDER}}
                >
                    <Tooltip title="Show files" placement="left">
                        <span className="flex h-7 w-7 items-center justify-center rounded text-colorTextSecondary transition-colors group-hover:text-colorText">
                            <Sidebar size={15} />
                        </span>
                    </Tooltip>
                    {drive.fileCount > 0 ? (
                        <Tooltip
                            title={`${drive.fileCount} file${drive.fileCount === 1 ? "" : "s"} in this conversation`}
                            placement="left"
                        >
                            <span className="relative flex h-7 w-7 items-center justify-center text-colorTextSecondary">
                                <FolderSimple size={15} />
                                <span className="absolute right-0 top-0 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[var(--ag-colorPrimary)] px-1 text-[9px] font-semibold leading-none text-[var(--ag-colorBgContainer)]">
                                    {drive.fileCount}
                                </span>
                            </span>
                        </Tooltip>
                    ) : null}
                    {busy ? (
                        <Tooltip title="Agent is running" placement="left">
                            <span className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full rounded-full bg-colorInfo opacity-60 motion-safe:animate-ping" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-colorInfo" />
                            </span>
                        </Tooltip>
                    ) : null}
                </div>
            ) : (
                <ExpandedRail
                    drive={drive}
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
    onOpenFiles,
    onCollapse,
    onQuickLook,
}: {
    drive: ReturnType<typeof useSessionDrive>
    onOpenFiles: () => void
    onCollapse: () => void
    onQuickLook: (path: string) => void
}) => {
    const now = useRecentChangeClock(drive.lastTouchedAt)
    const showOrigin = driveHasMixedOrigins(drive.recents)
    return (
        <aside
            className="flex h-full flex-col overflow-y-auto border-0 border-l border-solid"
            style={{width: RAIL_WIDTH, borderColor: BORDER}}
        >
            <div className="flex items-center gap-1.5 px-3 pt-3">
                <span className="text-xs font-medium">Files</span>
                {drive.fileCount > 0 ? (
                    <Tag bordered className="m-0 !px-1.5 !text-[10px] font-normal leading-[16px]">
                        {drive.fileCount}
                    </Tag>
                ) : null}
                <div className="ml-auto flex items-center">
                    <Tooltip title="Open the Files drawer" placement="bottom">
                        <Button
                            type="text"
                            icon={<ArrowSquareOut size={13} />}
                            onClick={onOpenFiles}
                            aria-label="Open the files drawer"
                        />
                    </Tooltip>
                    <Tooltip title="Collapse panel" placement="bottom">
                        <Button
                            type="text"
                            icon={<Sidebar size={13} />}
                            onClick={onCollapse}
                            aria-label="Collapse panel"
                        />
                    </Tooltip>
                </div>
            </div>
            <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1">
                {drive.fileCount === 0 ? (
                    <Text type="secondary" className="px-1 pb-1 !text-[11px]">
                        {drive.isLoading ? "Loading…" : "No files yet."}
                    </Text>
                ) : (
                    <>
                        {/* The recent files as friendly thumbnail cards (a preview a user recognises
                            at a glance) — the rail has room for it; older files live behind "View
                            all files". */}
                        <MotionConfig reducedMotion="user">
                            <AnimatePresence mode="popLayout" initial={false}>
                                {drive.recents.slice(0, 5).map((file) => {
                                    // Route the thumbnail read to the file's own mount (cwd or
                                    // agent-files); the card still displays the presented path.
                                    const resolved = drive.resolveMount(file.path)
                                    return (
                                        <motion.div
                                            key={file.path}
                                            layout
                                            variants={FILE_ITEM_VARIANTS}
                                            initial="initial"
                                            animate="animate"
                                            exit="exit"
                                            transition={FILE_SPRING}
                                        >
                                            <DriveFileRow
                                                variant="card"
                                                path={file.path}
                                                file={
                                                    resolved ? {...file, path: resolved.path} : file
                                                }
                                                mount={resolved?.mount ?? drive.mount}
                                                showOrigin={showOrigin}
                                                recent={isRecentlyChanged(file.touchedAt, now)}
                                                trailing={
                                                    file.touchedAt
                                                        ? relativeTime(file.touchedAt).replace(
                                                              " ago",
                                                              "",
                                                          )
                                                        : undefined
                                                }
                                                onOpen={() => onQuickLook(file.path)}
                                            />
                                        </motion.div>
                                    )
                                })}
                            </AnimatePresence>
                        </MotionConfig>
                        {drive.fileCount > 5 ? (
                            <button
                                type="button"
                                onClick={onOpenFiles}
                                className="mt-0.5 w-fit cursor-pointer rounded border-0 bg-transparent px-1.5 py-0.5 text-xs text-[var(--ag-colorInfo)] hover:underline"
                            >
                                View all files
                            </button>
                        ) : null}
                    </>
                )}
            </div>
        </aside>
    )
}
