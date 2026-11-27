import {useConfigDrive} from "@agenta/entities/drive"
import {useT} from "@agenta/i18n"
import driveRailCatalog from "@agenta/i18n/catalogs/entityUi.driveRail"
import {ConfigRowTrailing} from "@agenta/ui/components/presentational"
import {SimpleTooltip, SkeletonBlock, Spinner} from "@agenta/ui/ui"

import {FilesPaneToggle} from "./FilesPaneToggle"
import {useSessionFilesPane} from "./SessionFilesPane"

const MUTED = "text-meta text-muted-foreground"

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
    const t = useT(driveRailCatalog)
    const {drive} = useConfigDrive(revisionId, sessionId)
    const count = drive.fileCount
    const label =
        count === 0
            ? t("entityUi.driveRail.noFiles")
            : drive.fileCountCapped
              ? t("entityUi.driveRail.filesCountCapped", {count})
              : t("entityUi.driveRail.filesCount", {count})

    return (
        <div className="flex items-center gap-1.5">
            {drive.isLoading ? (
                <ConfigRowTrailing reserve={false}>
                    <SkeletonBlock className="h-3.5 w-11" />
                </ConfigRowTrailing>
            ) : drive.errored ? null : (
                <ConfigRowTrailing reserve={false}>
                    {drive.isFetching ? (
                        <Spinner
                            className="size-3"
                            aria-label={t("entityUi.driveRail.refreshing")}
                        />
                    ) : null}
                    <SimpleTooltip title={t("entityUi.driveRail.totalFiles")}>
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
