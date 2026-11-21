import {RECENT_TRIGGER_DELIVERIES_LIMIT} from "@agenta/entities/gatewayTrigger"
import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import {timeAgo} from "@agenta/shared/utils"
import {SkeletonBlock} from "@agenta/ui/ui"

import {type Automation} from "./automationModel"
import {useAutomationRuns} from "./useAutomationRuns"

/** When an automation last ran and how often — Status says it is on, this says it is doing anything. */
export const AutomationLastRunCell = ({automation}: {automation: Automation}) => {
    const t = useT(automationsEditorCatalog)
    const {runs, recentCount, counted, isLoading} = useAutomationRuns(automation, {
        recent: true,
    })
    const newest = runs[0]

    if (isLoading) {
        return (
            <span className="flex flex-col gap-1" aria-hidden>
                <SkeletonBlock active className="h-3.5 w-14" />
                <SkeletonBlock active className="h-3 w-10" />
            </span>
        )
    }

    if (!newest) {
        return (
            <span className="text-[13px] text-muted-foreground">
                {t("automations.editor.never")}
            </span>
        )
    }

    const at = Date.parse(newest.created_at ?? "")
    const when = Number.isFinite(at) ? timeAgo(at) : "—"
    const countLabel =
        recentCount > RECENT_TRIGGER_DELIVERIES_LIMIT
            ? t("automations.editor.runsIn30DaysOver", {limit: RECENT_TRIGGER_DELIVERIES_LIMIT})
            : t("automations.editor.runsIn30Days", {count: recentCount})

    return (
        <span className="flex min-w-0 flex-col">
            <span
                className="truncate text-[13px] text-foreground"
                title={newest.created_at ?? undefined}
            >
                {when}
            </span>
            {counted ? (
                <span className="truncate text-[12px] text-muted-foreground">{countLabel}</span>
            ) : null}
        </span>
    )
}
