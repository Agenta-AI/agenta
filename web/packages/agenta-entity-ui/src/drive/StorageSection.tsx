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

import {isAgentFileUploadsEnabled} from "@agenta/entities/drive"
import {configFilesDrawerOpenAtomFamily, useConfigDrive} from "@agenta/entities/drive"
import {listArrowKeyDown} from "@agenta/entities/drive"
import {FILE_ITEM_VARIANTS, FILE_SPRING} from "@agenta/entities/drive"
import {humanSize, relativeTime} from "@agenta/entities/drive"
import {isRecentlyChanged, useRecentChangeClock} from "@agenta/entities/drive"
import {useStageDrop} from "@agenta/entities/drive"
import {driveHasMixedOrigins, type DriveRecentFile} from "@agenta/entities/drive"
import {CircleNotch} from "@phosphor-icons/react"
import {useAtom, useSetAtom} from "jotai"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {type DriveId} from "./DriveExplorer"
import {DriveFileRow, DriveRetryButton, SKELETON_ROW_COUNT} from "./DriveFileRow"
import {DriveItemContextMenu, useCopyDrivePath, useDriveItemDownload} from "./DriveItemContextMenu"
import {DriveSessionProvider} from "./driveSessionContext"
import {FilesDrawer} from "./FilesDrawer"
import {driveQuickLookAtomFamily} from "./quickLook"
import {filesDrawerStagedAtomFamily} from "./SessionFilesDrawer"
import {useSessionFilesPane} from "./SessionFilesPane"

/** antd `Typography.Text` stand-in: the only prop this module used is `type="secondary"`. */
const Text = ({
    type: _type,
    className,
    children,
    ...rest
}: React.HTMLAttributes<HTMLSpanElement> & {type?: "secondary"}) => (
    <span className={`text-colorTextSecondary ${className ?? ""}`} {...rest}>
        {children}
    </span>
)

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

export default function StorageSection({
    revisionId,
    sessionId,
    scope,
}: {
    revisionId?: string | null
    /** The conversation whose drive this is. The host resolves it; empty = no conversation. */
    sessionId?: string | null
    /** Chat-panel scope key — the docked pane's open flag is panel-level, not per session. The
     * host resolves it (a package cannot read the app's chat slice). */
    scope: string
}) {
    const {drive, sessionId: resolvedSessionId, artifactId} = useConfigDrive(revisionId, sessionId)
    // A row opens the chat's DOCKED pane on that file with the tree collapsed; the header's icon
    // opens the browse-all DRAWER instead (see StorageFilesHeader).
    const {openPane: openPaneRoot} = useSessionFilesPane(scope, sessionId ?? "")
    const setQuickLook = useSetAtom(driveQuickLookAtomFamily(sessionId ?? ""))
    const setPaneStaged = useSetAtom(filesDrawerStagedAtomFamily(sessionId ?? ""))
    const [drawerOpen, setDrawerOpen] = useAtom(configFilesDrawerOpenAtomFamily(revisionId ?? ""))
    const openPane = (initialPath: string | null) => {
        // No resolved session id → the per-session quick-look atom is not the one the docked pane
        // reads, so open at the root instead of writing into an orphaned bucket.
        if (initialPath && sessionId) setQuickLook({path: initialPath, hideTree: true})
        else openPaneRoot()
    }
    // Drop-to-stage: a file drag over the Files peek opens the drawer with the files staged, so the
    // destination folder is chosen there (this flat peek has no folder of its own).
    const {dropActive, dropProps: stageDropProps} = useStageDrop(
        isAgentFileUploadsEnabled() && drive.mount && sessionId
            ? (files) => setPaneStaged(files)
            : undefined,
    )
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
        <div
            className={`flex flex-col gap-2 rounded-md transition-colors ${dropActive ? "bg-[var(--ant-color-primary-bg)]" : ""}`}
            {...stageDropProps}
        >
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
                                                  // Position only, never size: this list sits in a
                                                  // resizable pane, and a full `layout` re-projects
                                                  // every row from a stale snapshot on each resize
                                                  // tick, clipping/squashing its content. Width comes
                                                  // from CSS; enter/exit is what this animates.
                                                  layout="position"
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
                                                  layout="position"
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
                                                      onOpen={() => openPane(file.path)}
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
                                <div className="flex items-center gap-1.5 px-1.5 pt-1 text-xs text-colorTextTertiary">
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
                            <Text type="secondary" className="!text-xs !text-colorTextTertiary">
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
                Same component the chat uses; only the open-atom + resolved drive differ.

                Its own DriveSessionProvider because the drive it browses is THIS section's, not an
                ancestor's. The listing arrives as a prop, but the per-file actions inside read the
                ids from context — and the only providers were the chat surfaces, so on a
                configuration page with no conversation open there was no context at all and the
                files resolved to no mount (#6388). `useConfigDrive` already resolved both ids from
                the edited revision; the artifact one does not need a session to exist. */}
            <DriveSessionProvider sessionId={resolvedSessionId} artifactId={artifactId ?? null}>
                <FilesDrawer
                    open={drawerOpen}
                    onClose={() => setDrawerOpen(false)}
                    drive={drive}
                    driveIds={driveIds}
                    scope="session"
                    initialPath={null}
                    stagedFiles={[]}
                    onStagedChange={setPaneStaged}
                />
            </DriveSessionProvider>
        </div>
    )
}
