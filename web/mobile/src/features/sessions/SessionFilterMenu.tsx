import {useMemo} from "react"

import {AgentGlyph} from "@agenta/entity-ui/agent"
import {useSessionFilters, type SessionStatusFilter} from "@agenta/sessions/state"
import {FilterMenu, type FilterMenuSection} from "@agenta/ui/filter-menu"
import {
    Archive,
    CalendarBlank,
    Lightning,
    Minus,
    Robot,
    Rows,
    SquaresFour,
    Waveform,
} from "@phosphor-icons/react"

import {
    DEFAULT_SESSION_LIST_VIEW,
    isDefaultSessionListView,
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
 * Type is MULTI-select, and that is not cosmetic: "automation runs" picks WHICH sessions and
 * "archived" WIDENS the set. They are orthogonal, so collapsing them into one three-way choice
 * would quietly drop "archived automation runs".
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
    const {agentId, status, mode, includeArchived, setAgentId, setStatus, setMode, setIncludeArchived} =
        useSessionFilters()

    const sections = useMemo<FilterMenuSection[]>(() => {
        const type = [...(mode ? ["automation"] : []), ...(includeArchived ? ["archived"] : [])]
        return [
            {
                key: "type",
                label: "Type",
                icon: <Lightning size={ICON} />,
                multi: true,
                value: type,
                // Neither on is not "nothing selected" — it is the default list, which is the
                // sessions you started. Saying so beats an em dash.
                valueLabel: type.length ? undefined : "Sessions",
                options: [
                    {
                        value: "automation",
                        label: "Automation runs",
                        icon: <Lightning size={ICON} />,
                    },
                    {value: "archived", label: "Archived", icon: <Archive size={ICON} />},
                ],
                onChange: (value) => {
                    if (value === "automation") setMode(!mode)
                    else setIncludeArchived(!includeArchived)
                },
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
                        icon: <StatusDot className="bg-colorWarning" />,
                    },
                    {
                        value: "running",
                        label: "Running",
                        icon: <StatusDot className="bg-colorSuccess" />,
                    },
                    {value: "idle", label: "Idle", icon: <StatusDot className="bg-colorBorder" />},
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
                onChange: (value) => setAgentId(value === ALL_AGENTS ? null : value),
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
        includeArchived,
        mode,
        onChange,
        setAgentId,
        setIncludeArchived,
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
        includeArchived ||
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
