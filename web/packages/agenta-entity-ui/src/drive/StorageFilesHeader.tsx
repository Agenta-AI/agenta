import {useConfigDrive} from "@agenta/entities/drive"
import {ConfigRowTrailing} from "@agenta/ui/components/presentational"
import {SimpleTooltip, SkeletonBlock} from "@agenta/ui/ui"
import {CircleNotch, Warning} from "@phosphor-icons/react"

import {DriveWarningBadge} from "./DriveFileRow"
import {FilesPaneToggle} from "./FilesPaneToggle"
import {useSessionFilesPane} from "./SessionFilesPane"

const MUTED = "text-xs text-[var(--ag-colorTextTertiary)]"

function StorageFilesToggle({scope, sessionId}: {scope: string; sessionId: string}) {
    const {open, toggle} = useSessionFilesPane(scope, sessionId)
    return <FilesPaneToggle open={open} onToggle={toggle} disabled={!sessionId} />
}

export default function StorageFilesHeader({
    revisionId,
    sessionId,
    scope,
}: {
    revisionId?: string | null
    sessionId?: string | null
    /** Only playground hosts opt in to a toggle, with their authoritative pane scope. */
    scope?: string
}) {
    const {drive} = useConfigDrive(revisionId, sessionId)
    const count = drive.fileCount
    const shown = `${count}${drive.fileCountCapped ? "+" : ""}`
    const label =
        count === 0
            ? "No files"
            : count === 1 && !drive.fileCountCapped
              ? "1 file"
              : `${shown} files`

    return (
        <div className="flex items-center gap-1.5">
            {drive.isLoading ? (
                <ConfigRowTrailing reserve={false}>
                    <SkeletonBlock className="h-[14px] w-[44px]" />
                </ConfigRowTrailing>
            ) : drive.errored ? null : (
                <ConfigRowTrailing
                    reserve={false}
                    affordance={
                        drive.partialErrored ? (
                            <DriveWarningBadge show>
                                <Warning size={13} className="text-[var(--ag-colorTextTertiary)]" />
                            </DriveWarningBadge>
                        ) : undefined
                    }
                >
                    {drive.isFetching ? (
                        <CircleNotch size={11} className="animate-spin" aria-label="Refreshing" />
                    ) : null}
                    <SimpleTooltip title="Total files">
                        <span className={MUTED}>{label}</span>
                    </SimpleTooltip>
                </ConfigRowTrailing>
            )}
            {scope !== undefined ? (
                <StorageFilesToggle scope={scope} sessionId={sessionId ?? ""} />
            ) : null}
        </div>
    )
}
