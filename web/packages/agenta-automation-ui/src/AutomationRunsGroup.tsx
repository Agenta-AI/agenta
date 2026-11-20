import {useMemo, type ReactNode} from "react"

import {formatNextRun} from "@agenta/entities/gatewayTrigger"
import {scheduleTextNow} from "@agenta/entity-ui/gatewayTrigger"
import {useT} from "@agenta/i18n"
import automationsPanelCatalog from "@agenta/i18n/catalogs/automations.panel"
import {CaretRight} from "@phosphor-icons/react"

import {deliveryOutcome, type Automation} from "./automationModel"
import {ROW_LINK} from "./lib/interactive"
import {cn} from "./lib/utils"
import {runDotClass, runWhenLabel} from "./runModel"
import {useRecentAutomationRuns} from "./useAutomationRuns"

const GroupTitle = ({title, action}: {title: string; action?: ReactNode}) => (
    <div className="flex min-h-8 items-center gap-2">
        <h2 className="m-0 flex-1 text-[13px] font-semibold text-foreground">{title}</h2>
        {action}
    </div>
)

/** A group of the automation view: "Runs" or "Settings", with its title and its own action. */
export const AutomationGroup = ({
    title,
    action,
    children,
}: {
    title: string
    action?: ReactNode
    children: ReactNode
}) => (
    <section className="flex flex-col gap-2">
        <GroupTitle title={title} action={action} />
        {children}
    </section>
)

/**
 * "Runs" (F05 f5): what happened and what will happen. The next run (a schedule only; an event
 * has no planned time), the last run with its result (a click opens that run), and the history.
 * Its one action, "Run now", sits in the title.
 */
export const AutomationRunsGroup = ({
    automation,
    runNow,
    onOpenRunHistory,
}: {
    automation: Automation
    runNow?: ReactNode
    /** Opens the run history; with a run id, that run open. */
    onOpenRunHistory: (runId?: string) => void
}) => {
    const t = useT(automationsPanelCatalog)
    const {runs, caption} = useRecentAutomationRuns(automation)
    const newest = runs[0]
    const nextRun = useMemo(
        () =>
            automation.kind === "schedule" && automation.isActive && automation.cron
                ? formatNextRun(automation.cron, scheduleTextNow())
                : "",
        [automation.cron, automation.isActive, automation.kind],
    )
    const lastRunFailed = newest ? deliveryOutcome(newest) === "bad" : false

    return (
        <AutomationGroup title={t("automations.panel.runs")} action={runNow}>
            <div className="flex flex-col rounded-lg border border-solid border-border">
                {nextRun ? (
                    <div className="px-3.5 py-2.5 text-[13px] text-foreground">{nextRun}</div>
                ) : null}
                {newest ? (
                    <button
                        type="button"
                        data-testid="automation-last-run"
                        onClick={() => onOpenRunHistory(newest.id ?? undefined)}
                        className={cn(
                            "flex w-full cursor-pointer items-center gap-3 border-0 border-t border-solid border-border bg-transparent px-3.5 py-2.5 text-left first:border-t-0",
                            ROW_LINK,
                        )}
                    >
                        <span className="w-20 shrink-0 text-[13px] text-muted-foreground">
                            {t("automations.panel.lastRun")}
                        </span>
                        <span
                            aria-hidden
                            className={cn("size-2 shrink-0 rounded-full", runDotClass(newest))}
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                            {[
                                runWhenLabel(newest),
                                lastRunFailed ? t("automations.panel.didNotFinish") : "",
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                        <CaretRight
                            aria-hidden
                            size={14}
                            className="shrink-0 text-muted-foreground"
                        />
                    </button>
                ) : null}
                <button
                    type="button"
                    onClick={() => onOpenRunHistory()}
                    className={cn(
                        "flex w-full cursor-pointer items-center gap-3 border-0 border-t border-solid border-border bg-transparent px-3.5 py-2.5 text-left first:border-t-0",
                        ROW_LINK,
                    )}
                >
                    <span className="w-20 shrink-0 text-[13px] text-muted-foreground">
                        {t("automations.panel.history")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                        {caption}
                    </span>
                    <span className="shrink-0 text-[13px] text-foreground">
                        {t("automations.panel.seeAllRuns")}
                    </span>
                </button>
            </div>
        </AutomationGroup>
    )
}
