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
import {Skeleton, Typography} from "antd"
import {useAtom} from "jotai"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {configFilesDrawerAtomFamily, useConfigDrive} from "./configDrive"
import {DriveDrawer} from "./DriveDrawer"
import {DriveFileRow} from "./DriveFileRow"
import {listArrowKeyDown} from "./driveKeyboard"
import {FILE_ITEM_VARIANTS, FILE_SPRING} from "./driveMotion"
import {humanSize, isHiddenPath, relativeTime} from "./driveTree"
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
    const {drive, sessionId, artifactId} = useConfigDrive(revisionId)
    // Drawer request is shared with the Files header (which opens it at the root); rows open it
    // preselected on the clicked file.
    const [drawer, setDrawer] = useAtom(configFilesDrawerAtomFamily(revisionId ?? ""))
    const openDrawer = (initialPath: string | null) => setDrawer({open: true, initialPath})
    // The browse drawer needs the WHOLE tree, but only once opened — gate the full listing on
    // `drawer.open` (empty ids disable the queries) so the always-mounted section stays on the
    // lightweight summary above.
    const fullDrive = useSessionDrive(
        drawer.open ? sessionId : "",
        drawer.open ? artifactId : undefined,
    )

    const now = useRecentChangeClock(drive.lastTouchedAt)
    // The compact config list is for the user's own files — drop internal/hidden (dot-prefixed)
    // entries like `.claude/…`; the full drawer still shows them (dimmed).
    const visibleRecents = drive.recents.filter((f) => !isHiddenPath(f.path))
    const showOrigin = driveHasMixedOrigins(visibleRecents)

    return (
        <div className="flex flex-col gap-2">
            {drive.isLoading ? (
                <Skeleton active title={false} paragraph={{rows: 2}} className="px-1" />
            ) : visibleRecents.length > 0 ? (
                // Files win regardless of session status — the agent's durable folder is per-artifact,
                // so it shows even before any conversation opens.
                <div className="flex flex-col" onKeyDown={listArrowKeyDown}>
                    <MotionConfig reducedMotion="user">
                        <AnimatePresence mode="popLayout" initial={false}>
                            {visibleRecents.slice(0, 5).map((file) => (
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
                drive={fullDrive}
                subtitleId={sessionId}
                scope="session"
                initialPath={drawer.initialPath}
            />
        </div>
    )
}
