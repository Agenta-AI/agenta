/** A quiet "Temporary" pill on a session-cwd file; a drive's files carry none (their folder says
 * so). */
import {type FileOrigin} from "@agenta/entities/drive"
import {useT} from "@agenta/i18n"
import drivePreviewCatalog from "@agenta/i18n/catalogs/entityUi.drivePreview"
import {SimpleTooltip as Tooltip} from "@agenta/ui/ui"

/** The info color at 55% — the recent-file left rule. */
export const AGENT_ACCENT_SOFT = "color-mix(in oklab, var(--info) 55%, transparent)"

export const OriginTag = ({origin}: {origin: FileOrigin}) => {
    const t = useT(drivePreviewCatalog)
    return origin !== "session" ? null : (
        <Tooltip title={t("entityUi.drivePreview.temporaryFileTip")}>
            <span className="inline-flex shrink-0 cursor-default items-center rounded-sm border border-solid border-border-muted px-1 align-middle text-caption text-muted-foreground">
                {t("entityUi.drivePreview.temporary")}
            </span>
        </Tooltip>
    )
}
