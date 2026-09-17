/**
 * StorageFilesHeader — the right-side content of the config panel's "Files" header bar: the file
 * count, mirroring the sibling Triggers header. Opening the Files pane is the session bar's job
 * (its toggle shows the open state); the body's rows open it on one file.
 */
import {useConfigDrive} from "@agenta/entities/drive"
import {ConfigRowTrailing} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import {CircleNotch, Warning} from "@phosphor-icons/react"

import {DriveWarningBadge} from "./DriveFileRow"

const MUTED = "text-xs text-[var(--ag-colorTextTertiary)]"

export default function StorageFilesHeader({
    revisionId,
    sessionId,
}: {
    revisionId?: string | null
    /** The conversation whose drive this is. The host resolves it; empty = no conversation. */
    sessionId?: string | null
}) {
    const {drive} = useConfigDrive(revisionId, sessionId)

    if (drive.isLoading) {
        return (
            <ConfigRowTrailing>
                <SkeletonBlock className="h-[14px] w-[44px]" />
            </ConfigRowTrailing>
        )
    }

    if (drive.errored) {
        return (
            <ConfigRowTrailing>
                <span className={MUTED}>Unavailable</span>
            </ConfigRowTrailing>
        )
    }

    const count = drive.fileCount
    // "N+" when the count scan hit its cap on a very large tree (a floor, not exact).
    const shown = `${count}${drive.fileCountCapped ? "+" : ""}`
    const label =
        count === 0
            ? "No files"
            : count === 1 && !drive.fileCountCapped
              ? "1 file"
              : `${shown} files`

    return (
        <ConfigRowTrailing
            // A mount that failed (e.g. the agent mount over an empty session) badges the count.
            affordance={
                drive.partialErrored ? (
                    <DriveWarningBadge show>
                        <Warning size={13} className="text-[var(--ag-colorTextTertiary)]" />
                    </DriveWarningBadge>
                ) : undefined
            }
        >
            {/* The count survives a session switch (React Query keeps the swapped mount's last-known
                value while it revalidates), so a spinner says the shown count is being refreshed. */}
            {drive.isFetching ? (
                <CircleNotch size={11} className="animate-spin" aria-label="Refreshing" />
            ) : null}
            <span className={MUTED}>{label}</span>
        </ConfigRowTrailing>
    )
}
