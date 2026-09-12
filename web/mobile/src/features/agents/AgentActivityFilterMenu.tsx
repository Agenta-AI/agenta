import {useMemo} from "react"

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
    const {status, setStatus, archivedOnly, includeArchived} = useSessionFilters()

    const sections = useMemo<FilterMenuSection[]>(
        () => [
            {
                key: "status",
                label: "Status",
                icon: <Waveform size={ICON} />,
                value: status,
                options: [
                    {value: "all", label: "All", icon: <SquaresFour size={ICON} />},
                    {
                        value: "waiting",
                        label: waitingCount ? `Waiting ${waitingCount}` : "Waiting",
                        icon: <StatusDot className="bg-[var(--ag-run-status-warning)]" />,
                    },
                    {
                        value: "running",
                        label: "Running",
                        icon: <StatusDot className="bg-[var(--ag-run-status-success)]" />,
                    },
                    {
                        value: "idle",
                        label: "Idle",
                        icon: <StatusDot className="bg-[var(--ag-run-status-default)]" />,
                    },
                ],
                onChange: (value) => setStatus(value as SessionStatusFilter),
            },
            {
                key: "activity",
                label: "Last activity",
                icon: <Clock size={ICON} />,
                value: view.activity,
                options: [
                    {value: "all", label: "All", icon: <SquaresFour size={ICON} />},
                    {value: "24h", label: "Today", icon: <Clock size={ICON} />},
                    {value: "7d", label: "Last 7 days", icon: <Clock size={ICON} />},
                    {value: "30d", label: "Last 30 days", icon: <Clock size={ICON} />},
                ],
                onChange: (value) => onChange({...view, activity: value as SessionActivityWindow}),
            },
            {
                key: "group",
                label: "Group by",
                icon: <Rows size={ICON} />,
                block: "sort",
                value: view.group,
                // The default first, as the Status and window rows lead with theirs.
                options: [
                    {value: "none", label: "None", icon: <Minus size={ICON} />},
                    {value: "date", label: "Date", icon: <CalendarBlank size={ICON} />},
                    {value: "status", label: "Status", icon: <Waveform size={ICON} />},
                ],
                onChange: (value) => onChange({...view, group: value as AgentActivityGrouping}),
            },
        ],
        [onChange, setStatus, status, view, waitingCount],
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
            triggerAriaLabel="Filter and group activity"
            size="icon-sm"
            active={active}
            onReset={onReset}
            resetDisabled={!active}
        />
    )
}
