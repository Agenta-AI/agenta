/**
 * StorageSection — the config panel's "Files" region body.
 *
 * One flat file view (no App/Session split — the config surface is "simply files"): the active
 * conversation's working files, newest first, with the full relative path (mono) so the raw
 * cwd/session UUIDs stay abstracted away. Rows open the DriveDrawer preselected on the clicked
 * file; the Files header count (StorageFilesHeader) opens it at the tree root. The agent's durable
 * folder is a subfolder of this working folder, so it needs no separate drive here. Lives in the
 * app layer because it reads the chat slice's session state.
 */
import {useMemo} from "react"

import {CircleNotch} from "@phosphor-icons/react"
import {Typography} from "antd"
import {useAtom} from "jotai"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {configFilesDrawerAtomFamily, useConfigDrive} from "./configDrive"
import {type DriveId} from "./DriveExplorer"
import {DriveFileRow, DriveRetryButton, SKELETON_ROW_COUNT} from "./DriveFileRow"
import {DriveItemContextMenu, useCopyDrivePath, useDriveItemDownload} from "./DriveItemContextMenu"
import {listArrowKeyDown} from "./driveKeyboard"
import {FILE_ITEM_VARIANTS, FILE_SPRING} from "./driveMotion"
import {humanSize, relativeTime} from "./driveTree"
import {FilesDrawer} from "./FilesDrawer"
import {isRecentlyChanged, useRecentChangeClock} from "./recentChange"
import {driveHasMixedOrigins, type DriveRecentFile} from "./useSessionDrive"

const {Text} = Typography

const RecentFileRow = ({
    file,
    recent,
    showOrigin,
    onOpen,
    onCopyPath,
    onDownload,
}: {
    file: DriveRecentFile
    recent?: boolean
    showOrigin?: boolean
    onOpen: () => void
    onCopyPath: (path: string) => void
    onDownload: (path: string, isFolder: boolean) => void
}) => (
    <DriveItemContextMenu
        path={file.path}
        isFolder={!!file.is_folder}
        onOpen={onOpen}
        onCopyPath={onCopyPath}
        onDownload={onDownload}
        className="w-full"
    >
        <DriveFileRow
            path={file.path}
            recent={recent}
            showOrigin={showOrigin}
            isFolder={!!file.is_folder}
            trailing={
                <>
                    {file.is_folder
                        ? // Rollup folders carry a count; the top-level shallow fallback doesn't (a
                          // count needs a descent) — so show it only when known, never a wrong "0".
                          file.item_count != null
                            ? `${file.item_count} item${file.item_count === 1 ? "" : "s"}`
                            : null
                        : humanSize(file.size)}
                    {file.touchedAt ? <> · {relativeTime(file.touchedAt)}</> : null}
                </>
            }
            onOpen={onOpen}
        />
    </DriveItemContextMenu>
)

export default function StorageSection({revisionId}: {revisionId?: string | null}) {
    const {drive, sessionId} = useConfigDrive(revisionId)
    // Drawer request is shared with the Files header (which opens it at the root); rows open it
    // preselected on the clicked file.
    const [drawer, setDrawer] = useAtom(configFilesDrawerAtomFamily(revisionId ?? ""))
    const openDrawer = (initialPath: string | null) => setDrawer({open: true, initialPath})
    const copyPath = useCopyDrivePath()
    const download = useDriveItemDownload(drive)
    // Raw ids for the drawer header's overflow menu (the drive id + the session it belongs to).
    const driveIds = useMemo(
        () =>
            [
                drive.mount?.id ? {key: "mount", label: "Drive ID", value: drive.mount.id} : null,
                sessionId ? {key: "owner", label: "Session ID", value: sessionId} : null,
            ].filter(Boolean) as DriveId[],
        [drive.mount?.id, sessionId],
    )

    const now = useRecentChangeClock(drive.lastTouchedAt)
    // Render the drive's canonical recents verbatim (no local filtering) so the config Files list and
    // the chat rail/runtime lens — all backed by the SAME summary — show the SAME rows. Hidden
    // (dot-prefixed) entries are dimmed by the row, not dropped, and clone dumps are already rolled
    // up into a single folder row by the backend.
    const visibleRecents = drive.recents
    const showOrigin = driveHasMixedOrigins(visibleRecents)

    // The loading skeleton is NOT a separate block — it's the same list rendering placeholder rows,
    // so the resolve is a per-row content swap (skeleton → real) inside one AnimatePresence, with zero
    // layout shift. Terminal states (error / no-session / no-changes / empty) crossfade with the list.
    const showSkeleton = drive.isLoading
    const rows = visibleRecents.slice(0, 5)
    // `reconciling` keeps us in the list surface (content + a "Loading more…" hint) while a sibling
    // drive is still loading — so the terminal "No files" never flashes before all drives resolve.
    const phase = drive.errored
        ? "error"
        : showSkeleton || rows.length > 0 || drive.reconciling
          ? "list"
          : !sessionId
            ? "no-session"
            : drive.fileCount > 0
              ? "no-changes"
              : "empty"

    return (
        <div className="flex flex-col gap-2">
            <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                    key={phase}
                    initial={{opacity: 0}}
                    animate={{opacity: 1}}
                    exit={{opacity: 0}}
                    transition={{duration: 0.15}}
                >
                    {phase === "list" ? (
                        // Files win regardless of session status — the agent's durable folder is
                        // per-artifact, so it shows even before any conversation opens.
                        <div
                            className="flex flex-col"
                            onKeyDown={listArrowKeyDown}
                            aria-busy={showSkeleton || undefined}
                        >
                            <MotionConfig reducedMotion="user">
                                <AnimatePresence mode="popLayout" initial={false}>
                                    {showSkeleton
                                        ? Array.from({length: SKELETON_ROW_COUNT}, (_, i) => (
                                              <motion.div
                                                  key={`__sk-${i}`}
                                                  layout
                                                  variants={FILE_ITEM_VARIANTS}
                                                  initial="initial"
                                                  animate="animate"
                                                  exit="exit"
                                                  transition={FILE_SPRING}
                                              >
                                                  <DriveFileRow loading skeletonIndex={i} />
                                              </motion.div>
                                          ))
                                        : rows.map((file) => (
                                              <motion.div
                                                  key={file.path}
                                                  layout
                                                  variants={FILE_ITEM_VARIANTS}
                                                  initial="initial"
                                                  animate="animate"
                                                  exit="exit"
                                                  transition={FILE_SPRING}
                                              >
                                                  <RecentFileRow
                                                      file={file}
                                                      recent={isRecentlyChanged(
                                                          file.touchedAt,
                                                          now,
                                                      )}
                                                      showOrigin={showOrigin}
                                                      onOpen={() => openDrawer(file.path)}
                                                      onCopyPath={copyPath}
                                                      onDownload={download}
                                                  />
                                              </motion.div>
                                          ))}
                                </AnimatePresence>
                            </MotionConfig>
                            {/* One mount is in but another is still loading — a quiet hint, NOT a
                                skeleton that would hide the files already shown. */}
                            {!showSkeleton && (drive.reconciling || drive.isFetching) ? (
                                <div className="flex items-center gap-1.5 px-1.5 pt-1 text-[11px] text-colorTextTertiary">
                                    <CircleNotch size={11} className="animate-spin" />
                                    <span>Loading more…</span>
                                </div>
                            ) : null}
                        </div>
                    ) : phase === "error" ? (
                        <div className="flex flex-col gap-1">
                            <Text type="secondary" className="!text-xs">
                                Couldn&rsquo;t load files.{" "}
                                {drive.retry ? (
                                    <DriveRetryButton
                                        onRetry={drive.retry}
                                        busy={drive.isFetching}
                                    />
                                ) : null}
                            </Text>
                            {/* The diagnostic is now secondary + conditional — a retry may well fix a
                                transient failure; the "not configured" hint only matters if it keeps
                                failing (self-hosted deploys without an object store). */}
                            <Text type="secondary" className="!text-[11px] !text-colorTextTertiary">
                                If it keeps failing, the file store may not be configured on this
                                deployment.
                            </Text>
                        </div>
                    ) : phase === "no-session" ? (
                        <Text type="secondary" className="!text-xs">
                            No conversation open yet — the agent&rsquo;s working files appear here
                            once a chat starts.
                        </Text>
                    ) : phase === "no-changes" ? (
                        // Files exist in the drive, but none were written/edited in THIS conversation
                        // (the recents come from its record log) — surface the count, not "no files".
                        <Text type="secondary" className="!text-xs">
                            No changes in this conversation yet — open Files to browse all{" "}
                            {drive.fileCount}
                            {drive.fileCountCapped ? "+" : ""}.
                        </Text>
                    ) : (
                        <Text type="secondary" className="!text-xs">
                            No files yet — the agent gets its working folder on the first run.
                        </Text>
                    )}
                </motion.div>
            </AnimatePresence>

            {/* The ONE Files drawer (DriveExplorer: lazy per-directory loading + the single header).
                Same component the chat uses; only the open-atom + resolved drive differ. */}
            <FilesDrawer
                open={drawer.open}
                onClose={() => setDrawer((prev) => ({...prev, open: false}))}
                drive={drive}
                driveIds={driveIds}
                scope="session"
                initialPath={drawer.initialPath}
            />
        </div>
    )
}
