import {useMemo} from "react"

import {AgentGlyph} from "@agenta/entity-ui/agent"
import {useSessionFilters, type SessionStatusFilter} from "@agenta/sessions/state"
import {FilterMenu, type FilterMenuItem} from "@agenta/ui/filter-menu"
import {
    Archive,
    CalendarBlank,
    ChatCircle,
    Clock,
    Lightning,
    Minus,
    Robot,
    Rows,
    SquaresFour,
    Waveform,
} from "@phosphor-icons/react"

import {
    isDefaultSessionListView,
    type SessionActivityWindow,
    type SessionGrouping,
    type SessionListView,
} from "./sessionListView"

const ICON = 14

const ALL_AGENTS = "all"

/** The status filters get the dot a row paints, so the filter and the row read alike. */
const StatusDot = ({className}: {className: string}) => (
    <span aria-hidden className={`size-1.5 rounded-full ${className}`} />
)

/**
 * The sessions list's single view control — the same `FilterMenu` the automations list opens, so
 * the two nav entries offer one control rather than a popover on one and a toolbar of switches on
 * the other.
 *
 * Type names the ONE set on screen — Chat or Automation — the way the sidebar's Type facet does.
 * Archived is a switch rather than a third type: it is a lens over either set, and on it shows the
 * archived sessions INSTEAD of the live ones, so the page always answers a single question.
 *
 * No sort row: the server orders sessions by recency everywhere in this app, and a client-side
 * sort would only re-order the pages that happen to have loaded.
 */
export const SessionFilterMenu = ({
    view,
    onChange,
    agents,
    waitingCount,
    onReset,
}: {
    view: SessionListView
    onChange: (view: SessionListView) => void
    /** The roster the screen already reads, as `{id, name}` in display order. */
    agents: {id: string; name: string}[]
    /** Rides in the Waiting option's label — the menu has no room for a badge. */
    waitingCount?: number
    /**
     * Clears the filters, the grouping AND the search field. The field is a debounced draft the
     * atoms know nothing about, so a reset that only touched the atoms would leave the box
     * showing a term that no longer applies.
     */
    onReset: () => void
}) => {
    const {agentId, status, mode, archivedOnly, setAgentId, setStatus, setMode, setArchivedOnly} =
        useSessionFilters()

    const sections = useMemo<FilterMenuItem[]>(() => {
        return [
            {
                key: "type",
                label: "Type",
                // A bolt, not the robot: the robot means AGENT throughout this app, and an
                // automation is a trigger that ran one.
                icon: <Lightning size={ICON} />,
                value: mode ? "automation" : "chat",
                options: [
                    {value: "chat", label: "Chat", icon: <ChatCircle size={ICON} />},
                    {value: "automation", label: "Automation", icon: <Lightning size={ICON} />},
                ],
                // One list at a time, the way the sidebar's Type facet works. Chat is the default
                // because it is the set a reader means by "my sessions".
                onChange: (value) => setMode(value === "automation"),
            },
            {
                key: "status",
                label: "Status",
                icon: <Waveform size={ICON} />,
                value: status,
                // Ordered by what it costs to miss, and each dot is the one a row of that status
                // paints. `live` is not offered: "the sandbox is up" is a fact about the
                // infrastructure, and Running answers the question a reader is actually asking.
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
                key: "agent",
                label: "Agent",
                icon: <Robot size={ICON} />,
                value: agentId ?? ALL_AGENTS,
                options: [
                    {value: ALL_AGENTS, label: "All agents", icon: <Robot size={ICON} />},
                    ...agents.map((agent) => ({
                        value: agent.id,
                        label: agent.name,
                        // The agent's own glyph, as in the table's Agent column.
                        icon: (
                            <AgentGlyph
                                workflowId={agent.id}
                                size={ICON}
                                fallback={<Robot size={ICON} aria-hidden />}
                            />
                        ),
                    })),
                ],
                emptyText: "No agents yet",
                wide: true,
                onChange: (value) => setAgentId(value === ALL_AGENTS ? null : value),
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
                kind: "toggle",
                key: "archived",
                label: "Only archived",
                icon: <Archive size={ICON} />,
                checked: archivedOnly,
                onChange: setArchivedOnly,
            },
            {
                key: "group",
                label: "Group by",
                icon: <Rows size={ICON} />,
                block: "sort",
                value: view.group,
                options: [
                    {value: "agent", label: "Agent", icon: <Robot size={ICON} />},
                    {value: "date", label: "Date", icon: <CalendarBlank size={ICON} />},
                    {value: "status", label: "Status", icon: <Waveform size={ICON} />},
                    {value: "none", label: "None", icon: <Minus size={ICON} />},
                ],
                onChange: (value) => onChange({...view, group: value as SessionGrouping}),
            },
        ]
    }, [
        agentId,
        agents,
        archivedOnly,
        mode,
        onChange,
        setAgentId,
        setArchivedOnly,
        setMode,
        setStatus,
        status,
        view,
        waitingCount,
    ])

    // Search is its own field in the toolbar, so it does not dot this button — a control that
    // looks touched because someone typed next to it says nothing about what the menu holds.
    const active =
        Boolean(agentId) ||
        status !== "all" ||
        mode ||
        archivedOnly ||
        !isDefaultSessionListView(view)

    return (
        <FilterMenu
            sections={sections}
            align="start"
            // Icon alone: the table beside it is already the subject, and the word "Filter" added
            // a second label to a toolbar that has one.
            label={null}
            triggerAriaLabel="Filter and group sessions"
            size="default"
            // The square icon size is 28; the search field is 32.
            triggerClassName="size-8"
            active={active}
            onReset={onReset}
            resetDisabled={!active}
        />
    )
}
