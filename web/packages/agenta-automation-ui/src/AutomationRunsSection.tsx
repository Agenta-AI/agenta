import {useEffect, useMemo, useState, type ReactNode} from "react"

import {formatNextRun} from "@agenta/entities/gatewayTrigger"
import {scheduleTextNow} from "@agenta/entity-ui/gatewayTrigger"
import {createT, formatDate, textVersionAtom, useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import automationsPanelCatalog from "@agenta/i18n/catalogs/automations.panel"
import {ConfigAccordionSection} from "@agenta/ui/config-accordion"
import {CalendarBlank, ClockCounterClockwise, Play} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {type Automation} from "./automationModel"
import {AutomationRunStatusBadge} from "./AutomationRunStatusBadge"
import {runWhenLabel} from "./runModel"
import {AutomationRunsRowSkeleton} from "./states/AutomationStates"
import {useRecentAutomationRuns} from "./useAutomationRuns"

const tNow = createT(automationsEditorCatalog)

/** One Runs row: the muted card of the pane's item rows, opening a view when it can (CONS-02). */
const RunsRow = ({
    icon,
    label,
    badge,
    value,
    onOpen,
    testId,
}: {
    icon: ReactNode
    label: string
    badge?: ReactNode
    value: ReactNode
    onOpen?: () => void
    testId?: string
}) => (
    <div data-testid={testId}>
        <ConfigAccordionSection
            icon={icon}
            title={label}
            titleBadge={badge}
            summary={value}
            onOpen={onOpen}
            collapsible={false}
            bodyClassName="hidden"
            drawerAffordance="triangle"
            canvas="panel"
            noDivider
            iconTile
            preserveTitle
        />
    </div>
)

/** A part of the automation view: its heading with an optional action, 4px over its content. */
export const AutomationViewSection = ({
    title,
    action,
    children,
}: {
    title: string
    action?: ReactNode
    children: ReactNode
}) => (
    <section className="flex flex-col gap-1">
        <div className="flex min-h-5 items-center gap-2">
            <h2 className="m-0 flex-1 text-label font-semibold leading-5 text-foreground">
                {title}
            </h2>
            {action}
        </div>
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
    const textVersion = useAtomValue(textVersionAtom)
    const {runs, isLoading: runsLoading} = useRecentAutomationRuns(automation)
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
                tNow("automations.editor.nextRunAt", {
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
        // `textVersion` changes with the language, so the line is built again in the new one.
    }, [automation.cron, automation.isActive, automation.kind, tick, textVersion])
    return (
        <AutomationViewSection title={t("automations.panel.runs")} action={runNow}>
            <div className="flex flex-col gap-2">
                {nextRun ? (
                    <RunsRow
                        icon={<CalendarBlank />}
                        label={t("automations.editor.nextRunLabel")}
                        value={nextRun}
                    />
                ) : null}
                {newest ? (
                    <RunsRow
                        icon={<Play />}
                        label={t("automations.panel.lastRun")}
                        badge={<AutomationRunStatusBadge delivery={newest} />}
                        value={runWhenLabel(newest)}
                        testId="automation-last-run"
                        onOpen={() => onOpenRunHistory(newest.id ?? undefined)}
                    />
                ) : runsLoading ? (
                    // The Last run card keeps its slot while the runs load, so nothing below moves.
                    <AutomationRunsRowSkeleton />
                ) : null}
                <RunsRow
                    icon={<ClockCounterClockwise />}
                    label={t("automations.panel.history")}
                    value={t("automations.panel.seeAllRuns")}
                    onOpen={() => onOpenRunHistory()}
                />
            </div>
        </AutomationViewSection>
    )
}
