import {useMemo} from "react"

import {FilterMenu, type FilterMenuSection} from "@agenta/ui/filter-menu"
import {
    Archive,
    Clock,
    Lightning,
    Minus,
    Robot,
    Rows,
    SquaresFour,
    User,
    Users,
    Waveform,
} from "@phosphor-icons/react"

import {
    ALL_OWNERS,
    DEFAULT_AGENT_LIST_VIEW,
    isDefaultAgentListView,
    type AgentGrouping,
    type AgentListView,
    type AgentStatusFilter,
    type AgentTypeFilter,
} from "./agentListView"
import type {AgentOwner} from "./useAgentOwners"

const ICON = 14

/** The Status options get the dot a row paints, so the filter and the badge read alike. */
const StatusDot = ({className}: {className: string}) => (
    <span aria-hidden className={`size-1.5 rounded-full ${className}`} />
)

/**
 * The agents roster's single view control: which roster is on screen and who made it, then how
 * the rows are cut.
 *
 * Type names the ONE set on screen, the way the sessions menu's own Type facet does: Archived
 * shows the agents that were put away INSTEAD of the ones in use, never alongside them, so the
 * page always answers a single question.
 *
 * Status is the ONE state an agent has here: Waiting when a session of its own is blocked on a
 * person, Idle otherwise. No Running — nothing this client reads says an agent is mid-turn, and a
 * row that can never be picked is worse than an absent one. Not the automations menu's
 * working/paused either: that belongs to a trigger, and an agent has none.
 * No sort row either: the roster is newest-first everywhere, and a reader after a name has the
 * search field.
 *
 * Everything the shared `FilterMenu` knows about this screen arrives as props, so the package
 * never learns what an agent is and this file never re-implements a row or a check mark.
 */
export const AgentFilterMenu = ({
    view,
    onChange,
    owners,
}: {
    view: AgentListView
    onChange: (view: AgentListView) => void
    /** The org roster, as `{id, name}` in display order. */
    owners: AgentOwner[]
}) => {
    const sections = useMemo<FilterMenuSection[]>(
        () => [
            {
                key: "owner",
                label: "Created by",
                icon: <User size={ICON} />,
                value: view.owner,
                options: [
                    {value: ALL_OWNERS, label: "Anyone", icon: <Users size={ICON} />},
                    ...owners.map((owner) => ({
                        value: owner.id,
                        label: owner.name,
                        icon: <User size={ICON} />,
                    })),
                ],
                emptyText: "No members yet",
                onChange: (value) => onChange({...view, owner: value}),
            },
            {
                key: "type",
                label: "Type",
                // The bolt the sessions and automations menus give their own Type row: one facet,
                // one mark, whichever list you are reading.
                icon: <Lightning size={ICON} />,
                value: view.type,
                options: [
                    // The robot means AGENT throughout this app, so it marks the agents in use.
                    {value: "active", label: "Active", icon: <Robot size={ICON} />},
                    {value: "archived", label: "Archived", icon: <Archive size={ICON} />},
                ],
                onChange: (value) => onChange({...view, type: value as AgentTypeFilter}),
            },
            {
                key: "status",
                label: "Status",
                icon: <Waveform size={ICON} />,
                value: view.status,
                options: [
                    {value: "all", label: "All", icon: <SquaresFour size={ICON} />},
                    {
                        value: "waiting",
                        label: "Waiting",
                        icon: <StatusDot className="bg-colorWarning" />,
                    },
                    {
                        value: "idle",
                        label: "Idle",
                        icon: <StatusDot className="bg-muted-foreground" />,
                    },
                ],
                onChange: (value) => onChange({...view, status: value as AgentStatusFilter}),
            },
            {
                key: "group",
                label: "Group by",
                icon: <Rows size={ICON} />,
                block: "sort",
                value: view.group,
                options: [
                    {value: "none", label: "None", icon: <Minus size={ICON} />},
                    {value: "owner", label: "Created by", icon: <User size={ICON} />},
                    {value: "status", label: "Status", icon: <Waveform size={ICON} />},
                    {value: "activity", label: "Last activity", icon: <Clock size={ICON} />},
                ],
                onChange: (value) => onChange({...view, group: value as AgentGrouping}),
            },
        ],
        [onChange, owners, view],
    )

    return (
        <FilterMenu
            sections={sections}
            align="start"
            // Icon alone: the roster beside it is already the subject, and the word "Filter"
            // added a second label to a toolbar that has one.
            label={null}
            triggerAriaLabel="Filter agents"
            size="default"
            // The view toggle beside it is 32; a 28px funnel between them read as a mistake.
            triggerClassName="size-8"
            active={!isDefaultAgentListView(view)}
            onReset={() => onChange(DEFAULT_AGENT_LIST_VIEW)}
            resetDisabled={isDefaultAgentListView(view)}
        />
    )
}
