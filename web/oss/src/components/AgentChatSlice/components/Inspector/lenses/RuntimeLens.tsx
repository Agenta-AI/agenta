/**
 * RuntimeLens (build-spec §4.3) — live sandbox facts for the session, laid out with the SAME
 * ConfigAccordionSection pattern as the config panel (clean icon-titled collapsible sections, not
 * bespoke black cards): Lifecycle (streams + Attach/Detach/Kill), State, and Files. Lifecycle/State
 * reuse the endpoint-backed SessionInspector tabs; Files reuses the DRIVE stack (same listing +
 * Quick Look as everywhere else). Runtime is always session-level — a focused turn doesn't change
 * live facts.
 */
import {FILE_ITEM_VARIANTS, FILE_SPRING} from "@agenta/entities/drive"
import {humanSize} from "@agenta/entities/drive"
import {driveHasMixedOrigins, useSessionDriveSummary} from "@agenta/entities/drive"
import {
    DriveFileRow,
    DriveRetryButton,
    DriveWarningBadge,
    SKELETON_ROW_COUNT,
} from "@agenta/entity-ui/drive"
import {useDriveArtifactId} from "@agenta/entity-ui/drive"
import {driveQuickLookAtomFamily} from "@agenta/entity-ui/drive"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {Broadcast, CaretRight, CircleNotch, Database, FolderSimple} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {useSessionFilesPane} from "@/oss/components/Drives/SessionFilesPane"
import StatesTab from "@/oss/components/SessionInspector/tabs/StatesTab"
import StreamsTab from "@/oss/components/SessionInspector/tabs/StreamsTab"

/** The session's files, via the shared drive stack — a click opens the same Quick Look drawer as
 * the chat/config surfaces; "View all files" opens the docked Files pane. */
const DriveFilesCard = ({
    sessionId,
    drive,
}: {
    sessionId: string
    drive: ReturnType<typeof useSessionDriveSummary>
}) => {
    const openQuickLook = useSetAtom(driveQuickLookAtomFamily(sessionId))
    const {openPane: openFiles} = useSessionFilesPane(sessionId)

    // The loading skeleton is the SAME list rendering placeholder rows, so skeleton → real is a
    // per-row content swap inside one AnimatePresence (no block→list jump, no layout shift). Terminal
    // states (error / no-changes / empty) crossfade with the list.
    const showSkeleton = drive.isLoading
    const rows = drive.recents.slice(0, 5)
    // `reconciling` keeps us in the list surface (content + a "Loading more…" hint) while a sibling
    // drive is still loading — so the terminal "No files" never flashes before all drives resolve.
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
                initial={{opacity: 0}}
                animate={{opacity: 1}}
                exit={{opacity: 0}}
                transition={{duration: 0.15}}
                aria-busy={showSkeleton || undefined}
            >
                {phase === "error" ? (
                    <span className="text-xs text-colorTextTertiary">
                        Couldn&rsquo;t load this session&rsquo;s files.{" "}
                        {drive.retry ? (
                            <DriveRetryButton onRetry={drive.retry} busy={drive.isFetching} />
                        ) : null}
                    </span>
                ) : phase === "no-changes" ? (
                    // Files exist but none were written/edited in THIS conversation (recents come
                    // from its record log) — say so instead of an empty list.
                    <button
                        type="button"
                        onClick={() => openFiles()}
                        className="w-fit cursor-pointer rounded border-0 bg-transparent px-1.5 py-0.5 text-xs text-colorTextTertiary hover:text-colorText"
                    >
                        No changes yet — browse all {drive.fileCount}
                        {drive.fileCountCapped ? "+" : ""} files
                    </button>
                ) : phase === "empty" ? (
                    <span className="text-xs text-colorTextTertiary">
                        No files yet — this conversation gets its drive on first run.
                    </span>
                ) : (
                    <div className="flex flex-col">
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
                                    : rows.map((f) => (
                                          <motion.div
                                              key={f.path}
                                              layout
                                              variants={FILE_ITEM_VARIANTS}
                                              initial="initial"
                                              animate="animate"
                                              exit="exit"
                                              transition={FILE_SPRING}
                                          >
                                              <DriveFileRow
                                                  path={f.path}
                                                  isFolder={!!f.is_folder}
                                                  trailing={
                                                      f.is_folder
                                                          ? // Count only when known (top-level omits).
                                                            f.item_count != null
                                                              ? `${f.item_count} item${f.item_count === 1 ? "" : "s"}`
                                                              : undefined
                                                          : humanSize(f.size)
                                                  }
                                                  showOrigin={driveHasMixedOrigins(drive.recents)}
                                                  onOpen={() =>
                                                      f.is_folder
                                                          ? openFiles()
                                                          : openQuickLook({path: f.path})
                                                  }
                                              />
                                          </motion.div>
                                      ))}
                            </AnimatePresence>
                        </MotionConfig>
                        {!showSkeleton && (drive.reconciling || drive.isFetching) ? (
                            <div className="mt-1 flex items-center gap-1.5 px-1.5 text-xs text-colorTextTertiary">
                                <CircleNotch size={11} className="animate-spin" />
                                <span>Loading more…</span>
                            </div>
                        ) : null}
                        {drive.fileCount > 5 ? (
                            <button
                                type="button"
                                onClick={() => openFiles()}
                                className="mt-1 flex w-fit cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1.5 py-0.5 text-xs text-[var(--ag-colorInfo)] hover:underline"
                            >
                                View all files
                                <CaretRight size={11} />
                            </button>
                        ) : null}
                    </div>
                )}
            </motion.div>
        </AnimatePresence>
    )
}

export function RuntimeLens({sessionId}: {sessionId: string}) {
    const artifactId = useDriveArtifactId()
    const drive = useSessionDriveSummary(sessionId, artifactId ?? undefined)
    return (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3">
            <ConfigAccordionSection
                icon={<Broadcast size={16} className="text-colorTextSecondary" />}
                title="Lifecycle"
                size="compact"
            >
                <StreamsTab sessionId={sessionId} />
            </ConfigAccordionSection>
            <ConfigAccordionSection
                icon={<Database size={16} className="text-colorTextSecondary" />}
                title="State"
                size="compact"
            >
                <StatesTab sessionId={sessionId} />
            </ConfigAccordionSection>
            <ConfigAccordionSection
                // A mount failed but files still loaded → badge the section's OWN folder icon (no new
                // row, visible even collapsed); the retry lives in the drawer, reached from the card.
                icon={
                    <DriveWarningBadge show={drive.partialErrored}>
                        <FolderSimple size={16} className="text-colorTextSecondary" />
                    </DriveWarningBadge>
                }
                title="Files"
                size="compact"
                noDivider
            >
                <DriveFilesCard sessionId={sessionId} drive={drive} />
            </ConfigAccordionSection>
        </div>
    )
}
