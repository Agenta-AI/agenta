/**
 * StorageSection — the config panel's "Files" region body.
 *
 * One flat file view (no App/Session split — the config surface is "simply files"): the active
 * conversation's working files, newest first, with the full relative path (mono) so the raw
 * cwd/session UUIDs stay abstracted away. Rows open the DriveDrawer preselected on the clicked
 * file; "View all files" opens it at the tree root. The agent's durable folder is a subfolder of
 * this working folder, so it needs no separate drive here. Lives in the app layer because it reads
 * the chat slice's session state.
 */
import {useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {CaretRight} from "@phosphor-icons/react"
import {Skeleton, Typography} from "antd"
import {useAtomValue} from "jotai"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {useChatScopeKey} from "@/oss/components/AgentChatSlice/state/scope"
import {isSessionFresh} from "@/oss/components/AgentChatSlice/state/sessionEphemera"
import {
    activeSessionIdAtomFamily,
    sessionsListAtomFamily,
} from "@/oss/components/AgentChatSlice/state/sessions"

import {DriveDrawer} from "./DriveDrawer"
import {DriveFileRow} from "./DriveFileRow"
import {FILE_ITEM_VARIANTS, FILE_SPRING} from "./driveMotion"
import {humanSize, relativeTime} from "./driveTree"
import {isRecentlyChanged, useRecentChangeClock} from "./recentChange"
import {driveHasMixedOrigins, useSessionDrive, type DriveRecentFile} from "./useSessionDrive"

const {Text} = Typography

const RecentFileRow = ({
    file,
    recent,
    showOrigin,
    onOpen,
}: {
    file: DriveRecentFile
    recent?: boolean
    showOrigin?: boolean
    onOpen: () => void
}) => (
    <DriveFileRow
        path={file.path}
        label={file.path}
        recent={recent}
        showOrigin={showOrigin}
        trailing={
            <>
                {humanSize(file.size)}
                {file.touchedAt ? <> · {relativeTime(file.touchedAt)}</> : null}
            </>
        }
        onOpen={onOpen}
    />
)

export default function StorageSection({revisionId}: {revisionId?: string | null}) {
    const scope = useChatScopeKey()
    // The agent's durable folder (`agent-files/`) is keyed by the workflow artifact, not the
    // session — resolve it from the edited revision so it folds into this listing.
    const artifactId = useAtomValue(workflowMolecule.selectors.workflowId(revisionId ?? ""))
    const sessions = useAtomValue(sessionsListAtomFamily(scope))
    const rawActiveId = useAtomValue(activeSessionIdAtomFamily(scope))
    // Same fallback the chat uses: a stale active id (closed tab) resolves to the first open tab.
    const resolvedId = sessions.some((s) => s.id === rawActiveId)
        ? rawActiveId
        : (sessions[0]?.id ?? "")
    // A brand-new never-run tab has no server data by construction — hold the queries off (empty
    // id disables them) until its first run instead of asking the backend for guaranteed-empties.
    const sessionId = resolvedId && !isSessionFresh(resolvedId) ? resolvedId : ""

    const [drawer, setDrawer] = useState<{open: boolean; initialPath: string | null}>({
        open: false,
        initialPath: null,
    })
    const openDrawer = (initialPath: string | null) => setDrawer({open: true, initialPath})

    const drive = useSessionDrive(sessionId, artifactId ?? undefined)
    const now = useRecentChangeClock(drive.lastTouchedAt)
    const showOrigin = driveHasMixedOrigins(drive.recents)

    return (
        <div className="flex flex-col gap-2">
            {drive.isLoading ? (
                <Skeleton active title={false} paragraph={{rows: 2}} className="px-1" />
            ) : drive.fileCount > 0 ? (
                // Files win regardless of session status — the agent's durable folder is per-artifact,
                // so it shows even before any conversation opens.
                <div className="flex flex-col">
                    <MotionConfig reducedMotion="user">
                        <AnimatePresence mode="popLayout" initial={false}>
                            {drive.recents.slice(0, 5).map((file) => (
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
                                        recent={isRecentlyChanged(file.touchedAt, now)}
                                        showOrigin={showOrigin}
                                        onOpen={() => openDrawer(file.path)}
                                    />
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </MotionConfig>
                    {drive.fileCount > 5 ? (
                        <button
                            type="button"
                            onClick={() => openDrawer(null)}
                            className="mt-1 flex w-fit cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1.5 py-0.5 text-xs text-[var(--ag-colorInfo)] hover:underline"
                        >
                            View all files
                            <CaretRight size={11} />
                        </button>
                    ) : null}
                </div>
            ) : drive.errored ? (
                <Text type="secondary" className="!text-xs">
                    Couldn&rsquo;t load files — the file store may not be configured on this
                    deployment.
                </Text>
            ) : !sessionId ? (
                <Text type="secondary" className="!text-xs">
                    No conversation open yet — the agent&rsquo;s working files appear here once a
                    chat starts.
                </Text>
            ) : (
                <Text type="secondary" className="!text-xs">
                    No files yet — the agent gets its working folder on the first run.
                </Text>
            )}

            <DriveDrawer
                open={drawer.open}
                onClose={() => setDrawer((prev) => ({...prev, open: false}))}
                drive={drive}
                subtitleId={sessionId}
                scope="session"
                initialPath={drawer.initialPath}
            />
        </div>
    )
}
