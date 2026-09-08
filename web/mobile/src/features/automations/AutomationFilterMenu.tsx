import {useMemo} from "react"

import {
    AUTOMATION_STATUS_LABEL,
    DEFAULT_AUTOMATION_LIST_VIEW,
    isDefaultAutomationListView,
    type AutomationGrouping,
    type AutomationListView,
    type AutomationSort,
    type AutomationStatusFilter,
    type AutomationTypeFilter,
} from "@agenta/automation-ui"
import {AgentGlyph} from "@agenta/entity-ui/agent"
import {FilterMenu, type FilterMenuSection} from "@agenta/ui/filter-menu"
import {
    ArrowsDownUp,
    ClockClockwise,
    Lightning,
    Minus,
    Robot,
    Rows,
    SquaresFour,
    TextAa,
    Waveform,
} from "@phosphor-icons/react"

const ICON = 14

/** The two status filters get the dot the Status column paints, so filter and column read alike. */
const StatusDot = ({className}: {className: string}) => (
    <span aria-hidden className={`size-1.5 rounded-full ${className}`} />
)

/**
 * The automations list's single view control: type, status and agent above the divider, sort and
 * group below it.
 *
 * Everything the shared `FilterMenu` knows about this screen arrives here as props — the package
 * never learns what an automation is, and this file never re-implements a row, a flyout or a
 * check mark.
 */
export const AutomationFilterMenu = ({
    view,
    onChange,
    agents,
}: {
    view: AutomationListView
    onChange: (view: AutomationListView) => void
    /** The roster the screen already reads, as `{id, name}` in display order. */
    agents: {id: string; name: string}[]
}) => {
    const sections = useMemo<FilterMenuSection[]>(
        () => [
            {
                key: "type",
                label: "Type",
                icon: <Lightning size={ICON} />,
                value: view.type,
                options: [
                    {value: "all", label: "All", icon: <SquaresFour size={ICON} />},
                    {value: "schedule", label: "Schedule", icon: <ClockClockwise size={ICON} />},
                    {value: "event", label: "Event", icon: <Lightning size={ICON} />},
                ],
                onChange: (value) => onChange({...view, type: value as AutomationTypeFilter}),
            },
            {
                key: "status",
                label: "Status",
                icon: <Waveform size={ICON} />,
                value: view.status,
                options: [
                    {value: "all", label: "All", icon: <SquaresFour size={ICON} />},
                    {
                        value: "working",
                        label: AUTOMATION_STATUS_LABEL.working,
                        icon: <StatusDot className="bg-success" />,
                    },
                    {
                        value: "paused",
                        label: AUTOMATION_STATUS_LABEL.paused,
                        icon: <StatusDot className="bg-muted-foreground" />,
                    },
                ],
                onChange: (value) => onChange({...view, status: value as AutomationStatusFilter}),
            },
            {
                key: "agent",
                label: "Agent",
                icon: <Robot size={ICON} />,
                value: view.agent,
                options: [
                    {value: "all", label: "All agents", icon: <Robot size={ICON} />},
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
                onChange: (value) => onChange({...view, agent: value}),
            },
            {
                key: "sort",
                label: "Sort by",
                icon: <ArrowsDownUp size={ICON} />,
                block: "sort",
                value: view.sort,
                options: [
                    {value: "updated", label: "Last updated", icon: <ClockClockwise size={ICON} />},
                    {value: "name", label: "Name", icon: <TextAa size={ICON} />},
                ],
                onChange: (value) => onChange({...view, sort: value as AutomationSort}),
            },
            {
                key: "group",
                label: "Group by",
                icon: <Rows size={ICON} />,
                block: "sort",
                value: view.group,
                options: [
                    {value: "none", label: "None", icon: <Minus size={ICON} />},
                    {value: "type", label: "Type", icon: <Lightning size={ICON} />},
                    {value: "status", label: "Status", icon: <Waveform size={ICON} />},
                    {value: "agent", label: "Agent", icon: <Robot size={ICON} />},
                ],
                onChange: (value) => onChange({...view, group: value as AutomationGrouping}),
            },
        ],
        [agents, onChange, view],
    )

    return (
        <FilterMenu
            sections={sections}
            align="start"
            // Icon alone: the table beside it is already the subject, and the word "Filter"
            // added a second label to a toolbar that has one.
            label={null}
            size="default"
            // The square icon size is 28; the search field and New automation are both 32.
            triggerClassName="size-8"
            active={!isDefaultAutomationListView(view)}
            onReset={() => onChange(DEFAULT_AUTOMATION_LIST_VIEW)}
            resetDisabled={isDefaultAutomationListView(view)}
        />
    )
}
