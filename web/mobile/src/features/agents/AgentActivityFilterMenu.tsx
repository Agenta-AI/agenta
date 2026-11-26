import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import agentsActivity from "@agenta/i18n/catalogs/agents.activity"
import {useSessionFilters, type SessionStatusFilter} from "@agenta/sessions/state"
import {FilterMenu, type FilterMenuSection} from "@agenta/ui/filter-menu"
import {CalendarBlank, Clock, Minus, Rows, SquaresFour, Waveform} from "@phosphor-icons/react"

import type {SessionActivityWindow} from "../sessions/sessionListView"

import {
    isDefaultAgentActivityView,
    type AgentActivityGrouping,
    type AgentActivityView,
} from "./agentActivityView"

const ICON = 14

/** The status filters get the dot a row paints, so the filter and the row read alike. */
const StatusDot = ({className}: {className: string}) => (
    <span aria-hidden className={`size-1.5 rounded-full ${className}`} />
)

/**
 * The overview list's view control — the sessions page's menu minus the rows the page already
 * answers: no Type (the tabs are the type) and no Agent (every row is this agent's).
 *
 * Status is the shared session atom, so a status set here is the one the sessions page shows
 * too; the window and the grouping are this screen's own.
 */
export const AgentActivityFilterMenu = ({
    view,
    onChange,
    waitingCount,
    onReset,
}: {
    view: AgentActivityView
    onChange: (view: AgentActivityView) => void
    waitingCount?: number
    onReset: () => void
}) => {
    const t = useT(agentsActivity)
    const {status, setStatus, archivedOnly, includeArchived} = useSessionFilters()

    const sections = useMemo<FilterMenuSection[]>(
        () => [
            {
                key: "status",
                label: t("agents.activity.filterStatus"),
                icon: <Waveform size={ICON} />,
                value: status,
                options: [
                    {
                        value: "all",
                        label: t("agents.activity.filterAll"),
                        icon: <SquaresFour size={ICON} />,
                    },
                    {
                        value: "waiting",
                        label: waitingCount
                            ? t("agents.activity.filterWaitingCount", {n: waitingCount})
                            : t("agents.activity.filterWaiting"),
                        icon: <StatusDot className="bg-[var(--ag-run-status-warning)]" />,
                    },
                    {
                        value: "running",
                        label: t("agents.activity.filterRunning"),
                        icon: <StatusDot className="bg-[var(--ag-run-status-success)]" />,
                    },
                    {
                        value: "idle",
                        label: t("agents.activity.filterIdle"),
                        icon: <StatusDot className="bg-[var(--ag-run-status-default)]" />,
                    },
                ],
                onChange: (value) => setStatus(value as SessionStatusFilter),
            },
            {
                key: "activity",
                label: t("agents.activity.filterLastActivity"),
                icon: <Clock size={ICON} />,
                value: view.activity,
                options: [
                    {
                        value: "all",
                        label: t("agents.activity.filterAll"),
                        icon: <SquaresFour size={ICON} />,
                    },
                    {
                        value: "24h",
                        label: t("agents.activity.filterToday"),
                        icon: <Clock size={ICON} />,
                    },
                    {
                        value: "7d",
                        label: t("agents.activity.filterLast7Days"),
                        icon: <Clock size={ICON} />,
                    },
                    {
                        value: "30d",
                        label: t("agents.activity.filterLast30Days"),
                        icon: <Clock size={ICON} />,
                    },
                ],
                onChange: (value) => onChange({...view, activity: value as SessionActivityWindow}),
            },
            {
                key: "group",
                label: t("agents.activity.filterGroupBy"),
                icon: <Rows size={ICON} />,
                block: "sort",
                value: view.group,
                // The default first, as the Status and window rows lead with theirs.
                options: [
                    {
                        value: "none",
                        label: t("agents.activity.filterNone"),
                        icon: <Minus size={ICON} />,
                    },
                    {
                        value: "date",
                        label: t("agents.activity.filterDate"),
                        icon: <CalendarBlank size={ICON} />,
                    },
                    {
                        value: "status",
                        label: t("agents.activity.filterStatus"),
                        icon: <Waveform size={ICON} />,
                    },
                ],
                onChange: (value) => onChange({...view, group: value as AgentActivityGrouping}),
            },
        ],
        [onChange, setStatus, status, t, view, waitingCount],
    )

    // The archived atoms narrow this query too, set from the sessions page — so they dot the
    // trigger here, and Reset is the way back.
    const active =
        status !== "all" || archivedOnly || includeArchived || !isDefaultAgentActivityView(view)

    return (
        <FilterMenu
            sections={sections}
            align="end"
            label={null}
            triggerAriaLabel={t("agents.activity.filterTriggerLabel")}
            size="icon-sm"
            active={active}
            onReset={onReset}
            resetDisabled={!active}
        />
    )
}
