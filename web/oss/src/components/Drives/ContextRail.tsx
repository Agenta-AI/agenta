/**
 * ContextRail — the chat-mode right context rail (build-spec v2, view E1). Collapsible
 * (~300px ↔ slim strip, persisted). Shows the conversation's Files — recents + count +
 * "View all files". Jargon-free (never mount/cwd/drive); reuses the shared drive atoms (no new
 * fetch). Uses the same elevated dark surface as the build-mode Inspector so the right dock reads
 * as one panel across modes. A file row opens Quick Look; "View all files" opens the Files drawer.
 */
import {CircleNotch, FolderOpen, FolderSimple, Sidebar} from "@phosphor-icons/react"
import {Button, Tag, Tooltip, Typography} from "antd"
import {useAtom, useSetAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {isSessionFresh} from "@/oss/components/AgentChatSlice/state/sessionEphemera"

import {
    DriveFileRow,
    DriveRetryButton,
    DriveWarningBadge,
    FOCUS_RING,
    SKELETON_ROW_COUNT,
} from "./DriveFileRow"
import {DriveItemContextMenu, useCopyDrivePath, useDriveItemDownload} from "./DriveItemContextMenu"
import {listArrowKeyDown} from "./driveKeyboard"
import {FILE_ITEM_VARIANTS, FILE_SPRING} from "./driveMotion"
import {useDriveArtifactId} from "./driveSessionContext"
import {relativeTime} from "./driveTree"
import {driveQuickLookAtomFamily} from "./quickLook"
import {isRecentlyChanged, useRecentChangeClock} from "./recentChange"
import {type FileDropProps, useStageDrop} from "./useDriveDrop"
import {driveHasMixedOrigins, useSessionDriveSummary} from "./useSessionDrive"

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
    onStageFiles,
}: {
    sessionId: string
    /** The conversation is currently running a turn (drives the running indicator). */
    busy?: boolean
    /** Slide the rail away entirely (build mode / the Inspector owns the right edge). The
     * component stays MOUNTED so the width change animates instead of popping. */
    hidden?: boolean
    /** Open the Files drawer. */
    onOpenFiles: () => void
    /** Files dropped on the rail → stage them and open the drawer to pick a destination. Omit to
     * disable drop-to-stage. */
    onStageFiles?: (files: File[]) => void
}) {
    const [open, setOpen] = useAtom(contextRailOpenAtom)
    // Drop-to-stage: a file drag over the rail (strip or expanded) opens the drawer with the files
    // staged, so the destination is chosen there (recents has no folder of its own).
    const {dropActive, dropProps: stageDropProps} = useStageDrop(
        onStageFiles
            ? (files) => {
                  setOpen(true)
                  onStageFiles(files)
              }
            : undefined,
    )
    // A brand-new never-run tab has no server data — hold the queries off until its first run.
    const artifactId = useDriveArtifactId()
    const drive = useSessionDriveSummary(
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
                    className={`group flex h-full cursor-pointer flex-col items-center gap-2.5 border-0 border-l border-solid pt-3 transition-colors hover:bg-[var(--ag-colorFillTertiary)] ${dropActive ? "bg-[var(--ant-color-primary-bg)]" : ""}`}
                    style={{width: STRIP_WIDTH, borderColor: BORDER}}
                    {...stageDropProps}
                >
                    <Tooltip title="Show files" placement="left">
                        <span className="flex h-7 w-7 items-center justify-center rounded text-colorTextSecondary transition-colors group-hover:text-colorText">
                            <Sidebar size={15} />
                        </span>
                    </Tooltip>
                    {drive.fileCount > 0 || drive.partialErrored ? (
                        // A mount failure badges the folder (bottom-right, clear of the count pill) and
                        // swaps the tooltip to the retry hint; the strip already opens on click.
                        <Tooltip
                            title={
                                drive.partialErrored
                                    ? "Some files couldn’t be loaded — open to retry"
                                    : `${drive.fileCount}${drive.fileCountCapped ? "+" : ""} file${drive.fileCount === 1 && !drive.fileCountCapped ? "" : "s"} in this conversation`
                            }
                            placement="left"
                        >
                            <DriveWarningBadge
                                show={drive.partialErrored}
                                corner="br"
                                tooltip={false}
                            >
                                <span className="relative flex h-7 w-7 items-center justify-center text-colorTextSecondary">
                                    <FolderSimple size={15} />
                                    {drive.fileCount > 0 ? (
                                        <span className="absolute right-0 top-0 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[var(--ag-colorPrimary)] px-1 text-[9px] font-semibold leading-none text-[var(--ag-colorBgContainer)]">
                                            {drive.fileCount}
                                            {drive.fileCountCapped ? "+" : ""}
                                        </span>
                                    ) : null}
                                </span>
                            </DriveWarningBadge>
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
                    dropProps={stageDropProps}
                    dropActive={dropActive}
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
    dropProps,
    dropActive,
}: {
    drive: ReturnType<typeof useSessionDriveSummary>
    onOpenFiles: () => void
    onCollapse: () => void
    onQuickLook: (path: string) => void
    /** Drop-to-stage handlers + highlight, forwarded from ContextRail (shared with the strip). */
    dropProps?: FileDropProps
    dropActive?: boolean
}) => {
    const now = useRecentChangeClock(drive.lastTouchedAt)
    const showOrigin = driveHasMixedOrigins(drive.recents)
    const copyPath = useCopyDrivePath()
    const download = useDriveItemDownload(drive)
    return (
        <aside
            className={`flex h-full flex-col overflow-y-auto border-0 border-l border-solid transition-colors ${dropActive ? "bg-[var(--ant-color-primary-bg)]" : ""}`}
            style={{width: RAIL_WIDTH, borderColor: BORDER}}
            {...dropProps}
        >
            <div className="flex items-center gap-1.5 px-3 pt-3">
                <span className="text-xs font-medium">Files</span>
                {drive.fileCount > 0 ? (
                    <Tag bordered className="m-0 !px-1.5 !text-[10px] font-normal leading-[16px]">
                        {drive.fileCount}
                        {drive.fileCountCapped ? "+" : ""}
                    </Tag>
                ) : null}
                <div className="ml-auto flex items-center">
                    {/* A mount failure badges the open-drawer folder and swaps its tooltip to the retry
                        hint (the drawer carries the actual Try again). */}
                    <Tooltip
                        title={
                            drive.partialErrored
                                ? "Some files couldn’t be loaded — open to retry"
                                : "Open the Files drawer"
                        }
                        placement="bottom"
                    >
                        <Button
                            type="text"
                            icon={
                                <DriveWarningBadge show={drive.partialErrored} tooltip={false}>
                                    <FolderOpen size={13} />
                                </DriveWarningBadge>
                            }
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
            <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1" onKeyDown={listArrowKeyDown}>
                {(() => {
                    // The loading skeleton is the SAME card list rendering placeholder cards, so
                    // skeleton → real is a per-card content swap in one AnimatePresence (no block→list
                    // jump, no layout shift). Terminal text states crossfade with the list.
                    const showSkeleton = drive.isLoading
                    const rows = drive.recents.slice(0, 5)
                    // `reconciling` keeps us in the list surface (content + a "Loading more…" hint)
                    // while a sibling drive is still loading — so the terminal "No files" never
                    // flashes before all drives resolve.
                    const phase = drive.errored
                        ? "error"
                        : showSkeleton || rows.length > 0 || drive.reconciling
                          ? "list"
                          : drive.fileCount > 0
                            ? "no-changes"
                            : "empty"
                    return (
                        <AnimatePresence mode="popLayout" initial={false}>
                            <motion.div
                                key={phase}
                                className="flex flex-col gap-1.5"
                                initial={{opacity: 0}}
                                animate={{opacity: 1}}
                                exit={{opacity: 0}}
                                transition={{duration: 0.15}}
                                aria-busy={showSkeleton || undefined}
                            >
                                {phase === "error" ? (
                                    <Text type="secondary" className="px-1 pb-1 !text-[11px]">
                                        Couldn&rsquo;t load files.{" "}
                                        {drive.retry ? (
                                            <DriveRetryButton
                                                onRetry={drive.retry}
                                                busy={drive.isFetching}
                                            />
                                        ) : null}
                                    </Text>
                                ) : phase === "no-changes" ? (
                                    // Files exist but none changed in THIS conversation (recents = its
                                    // record log).
                                    <Text type="secondary" className="px-1 pb-1 !text-[11px]">
                                        No changes yet — open “View all files” to browse.
                                    </Text>
                                ) : phase === "empty" ? (
                                    <Text type="secondary" className="px-1 pb-1 !text-[11px]">
                                        No files yet.
                                    </Text>
                                ) : (
                                    <>
                                        {/* The recent files as friendly thumbnail cards (a preview a
                                            user recognises at a glance) — the rail has room; older
                                            files live behind "View all files". */}
                                        <MotionConfig reducedMotion="user">
                                            <AnimatePresence mode="popLayout" initial={false}>
                                                {showSkeleton
                                                    ? Array.from(
                                                          {length: SKELETON_ROW_COUNT},
                                                          (_, i) => (
                                                              <motion.div
                                                                  key={`__sk-${i}`}
                                                                  layout
                                                                  variants={FILE_ITEM_VARIANTS}
                                                                  initial="initial"
                                                                  animate="animate"
                                                                  exit="exit"
                                                                  transition={FILE_SPRING}
                                                              >
                                                                  <DriveFileRow
                                                                      loading
                                                                      variant="card"
                                                                      skeletonIndex={i}
                                                                  />
                                                              </motion.div>
                                                          ),
                                                      )
                                                    : rows.map((file) => {
                                                          // Route the thumbnail read to the file's own mount (cwd or
                                                          // agent-files); the card still displays the presented path.
                                                          const resolved = drive.resolveMount(
                                                              file.path,
                                                          )
                                                          const relTime = file.touchedAt
                                                              ? relativeTime(
                                                                    file.touchedAt,
                                                                ).replace(" ago", "")
                                                              : undefined
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
                                                                  <DriveItemContextMenu
                                                                      path={file.path}
                                                                      isFolder={!!file.is_folder}
                                                                      onOpen={() =>
                                                                          file.is_folder
                                                                              ? onOpenFiles()
                                                                              : onQuickLook(
                                                                                    file.path,
                                                                                )
                                                                      }
                                                                      onCopyPath={copyPath}
                                                                      onDownload={download}
                                                                      className="w-full"
                                                                  >
                                                                      <DriveFileRow
                                                                          variant="card"
                                                                          path={file.path}
                                                                          isFolder={
                                                                              !!file.is_folder
                                                                          }
                                                                          // Summary rail: icon thumbnails only — never read
                                                                          // each recent file's bytes just to preview it.
                                                                          staticThumb
                                                                          file={
                                                                              resolved
                                                                                  ? {
                                                                                        ...file,
                                                                                        path: resolved.path,
                                                                                    }
                                                                                  : file
                                                                          }
                                                                          mount={
                                                                              resolved?.mount ??
                                                                              drive.mount
                                                                          }
                                                                          showOrigin={showOrigin}
                                                                          recent={isRecentlyChanged(
                                                                              file.touchedAt,
                                                                              now,
                                                                          )}
                                                                          trailing={
                                                                              file.is_folder
                                                                                  ? // Count only when known (rollup folders
                                                                                    // have it; the top-level fallback not).
                                                                                    [
                                                                                        file.item_count !=
                                                                                        null
                                                                                            ? `${file.item_count} item${file.item_count === 1 ? "" : "s"}`
                                                                                            : null,
                                                                                        relTime,
                                                                                    ]
                                                                                        .filter(
                                                                                            Boolean,
                                                                                        )
                                                                                        .join(
                                                                                            " · ",
                                                                                        ) ||
                                                                                    undefined
                                                                                  : relTime
                                                                          }
                                                                          onOpen={() =>
                                                                              file.is_folder
                                                                                  ? onOpenFiles()
                                                                                  : onQuickLook(
                                                                                        file.path,
                                                                                    )
                                                                          }
                                                                      />
                                                                  </DriveItemContextMenu>
                                                              </motion.div>
                                                          )
                                                      })}
                                            </AnimatePresence>
                                        </MotionConfig>
                                        {!showSkeleton &&
                                        (drive.reconciling || drive.isFetching) ? (
                                            <div className="flex items-center gap-1.5 px-1 pt-0.5 text-[11px] text-colorTextTertiary">
                                                <CircleNotch size={11} className="animate-spin" />
                                                <span>Loading more…</span>
                                            </div>
                                        ) : null}
                                        {drive.fileCount > 5 ? (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.currentTarget.blur()
                                                    onOpenFiles()
                                                }}
                                                className={`mt-0.5 w-fit cursor-pointer rounded border-0 bg-transparent px-1.5 py-0.5 text-xs text-[var(--ag-colorInfo)] hover:underline ${FOCUS_RING}`}
                                            >
                                                View all files
                                            </button>
                                        ) : null}
                                    </>
                                )}
                            </motion.div>
                        </AnimatePresence>
                    )
                })()}
            </div>
        </aside>
    )
}
