import {useEffect, useMemo, useState, type ReactNode} from "react"

import {formatNextRun} from "@agenta/entities/gatewayTrigger"
import {scheduleTextNow} from "@agenta/entity-ui/gatewayTrigger"
import {formatDate, useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import automationsPanelCatalog from "@agenta/i18n/catalogs/automations.panel"
import {CaretRight} from "@phosphor-icons/react"

import {deliveryOutcome, type Automation} from "./automationModel"
import {ROW_LINK} from "./lib/interactive"
import {cn} from "./lib/utils"
import {runDotClass, runWhenLabel} from "./runModel"
import {useRecentAutomationRuns} from "./useAutomationRuns"

const GroupTitle = ({title, action}: {title: string; action?: ReactNode}) => (
    <div className="flex min-h-7 items-center gap-2">
        <h2 className="m-0 flex-1 text-[13px] font-semibold text-foreground">{title}</h2>
        {action}
    </div>
)

/** One row of the "Runs" card: a 72 px label, the value, and a chevron where it opens. */
const RunsRow = ({
    label,
    children,
    onClick,
    testId,
}: {
    label: string
    children: ReactNode
    onClick?: () => void
    testId?: string
}) => {
    const body = (
        <>
            <span className="w-[72px] shrink-0 text-[12px] text-muted-foreground">{label}</span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-foreground">
                {children}
            </span>
            {onClick ? (
                <CaretRight aria-hidden size={12} className="shrink-0 text-colorTextTertiary" />
            ) : null}
        </>
    )
    const frame =
        "flex w-full items-center gap-2.5 border-0 border-t border-solid border-colorSplit bg-transparent px-3 py-2.5 text-left first:border-t-0"
    return onClick ? (
        <button
            type="button"
            data-testid={testId}
            onClick={onClick}
            className={cn(frame, "cursor-pointer", ROW_LINK)}
        >
            {body}
        </button>
    ) : (
        <div className={frame}>{body}</div>
    )
}

/** A section of the automation view: "Runs" or "Settings", with its title and its own action. */
export const AutomationViewSection = ({
    title,
    action,
    children,
}: {
    title: string
    action?: ReactNode
    children: ReactNode
}) => (
    <section className="flex flex-col gap-1.5">
        <GroupTitle title={title} action={action} />
        {children}
    </section>
)

/**
 * "Runs" (F05 f5): what happened and what will happen. The next run (a schedule only; an event
 * has no planned time), the last run with its result (a click opens that run), and the history.
 * Its one action, "Run now", sits in the title.
 */
export const AutomationRunsSection = ({
    automation,
    runNow,
    onOpenRunHistory,
}: {
    automation: Automation
    runNow?: ReactNode
    /** Opens the run history; with a run id, that run open. */
    onOpenRunHistory: (runId?: string) => void
}) => {
    const t = useT(automationsPanelCatalog, automationsEditorCatalog)
    const {runs} = useRecentAutomationRuns(automation)
    const newest = runs[0]
    // "Next run" and its "in 14h" are read from the clock: a tick per minute keeps them true
    // while the view stays open, as the schedule row does.
    const [tick, setTick] = useState(0)
    useEffect(() => {
        const id = setInterval(() => setTick((count) => count + 1), 60_000)
        return () => clearInterval(id)
    }, [])
    // "Fri, Nov 20, 09:00 UTC · in 14 hours": the shared next-run line, with no "Next run" words,
    // since the row's label says it. A paused automation and an event have no next run.
    const nextRun = useMemo(() => {
        if (automation.kind !== "schedule" || !automation.isActive || !automation.cron) return ""
        const text = scheduleTextNow()
        return formatNextRun(automation.cron, {
            ...text,
            nextRun: (date, time, relative) =>
                t("automations.editor.nextRunAt", {
                    date: formatDate(date, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                    }),
                    time,
                    relative,
                }),
        })
        // `t` changes with the language, so the line is built again in the new one.
    }, [automation.cron, automation.isActive, automation.kind, tick, t])
    const lastRunFailed = newest ? deliveryOutcome(newest) === "bad" : false

    return (
        <AutomationViewSection title={t("automations.panel.runs")} action={runNow}>
            <div className="flex flex-col overflow-hidden rounded-lg border border-solid border-border">
                {nextRun ? (
                    <RunsRow label={t("automations.editor.nextRunLabel")}>
                        <span className="min-w-0 truncate">{nextRun}</span>
                    </RunsRow>
                ) : null}
                {newest ? (
                    <RunsRow
                        label={t("automations.panel.lastRun")}
                        testId="automation-last-run"
                        onClick={() => onOpenRunHistory(newest.id ?? undefined)}
                    >
                        <span
                            aria-hidden
                            className={cn("size-2 shrink-0 rounded-full", runDotClass(newest))}
                        />
                        <span className="min-w-0 truncate">
                            {[
                                runWhenLabel(newest),
                                lastRunFailed ? t("automations.panel.didNotFinish") : "",
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                    </RunsRow>
                ) : null}
                <RunsRow label={t("automations.panel.history")} onClick={() => onOpenRunHistory()}>
                    <span className="min-w-0 truncate">{t("automations.panel.seeAllRuns")}</span>
                </RunsRow>
            </div>
        </AutomationViewSection>
    )
}
