import {useMemo} from "react"

import {
    automationStatusLabel,
    automationTypeLabel,
    DEFAULT_AUTOMATION_LIST_VIEW,
    isDefaultAutomationListView,
    type AutomationGrouping,
    type AutomationListView,
    type AutomationStatusFilter,
    type AutomationTypeFilter,
    useAutomationText,
} from "@agenta/automation-ui"
import {AgentGlyph} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {FilterMenu, type FilterMenuSection} from "@agenta/ui/filter-menu"
import {
    ClockClockwise,
    Lightning,
    Minus,
    Robot,
    Rows,
    SquaresFour,
    Waveform,
} from "@phosphor-icons/react"

const ICON = 14

/** The two status filters get the dot the Status column paints, so filter and column read alike. */
const StatusDot = ({className}: {className: string}) => (
    <span aria-hidden className={`size-1.5 rounded-full ${className}`} />
)

/**
 * The automations list's single view control: type, status and agent, then how the rows are cut.
 *
 * No sort row: the list is newest-first everywhere in this app, and a reader who wants a name
 * has the search field. Grouping is the only cut worth choosing.
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
    const t = useT(automationsScreensCatalog)
    useAutomationText()
    const sections = useMemo<FilterMenuSection[]>(
        () => [
            {
                key: "type",
                label: t("automations.screens.filterType"),
                icon: <Lightning size={ICON} />,
                value: view.type,
                options: [
                    {
                        value: "all",
                        label: t("automations.screens.filterAll"),
                        icon: <SquaresFour size={ICON} />,
                    },
                    {
                        value: "schedule",
                        label: automationTypeLabel("schedule"),
                        icon: <ClockClockwise size={ICON} />,
                    },
                    {
                        value: "event",
                        label: automationTypeLabel("event"),
                        icon: <Lightning size={ICON} />,
                    },
                ],
                onChange: (value) => onChange({...view, type: value as AutomationTypeFilter}),
            },
            {
                key: "status",
                label: t("automations.screens.filterStatus"),
                icon: <Waveform size={ICON} />,
                value: view.status,
                options: [
                    {
                        value: "all",
                        label: t("automations.screens.filterAll"),
                        icon: <SquaresFour size={ICON} />,
                    },
                    {
                        value: "working",
                        label: automationStatusLabel("working"),
                        icon: <StatusDot className="bg-success" />,
                    },
                    {
                        value: "paused",
                        label: automationStatusLabel("paused"),
                        icon: <StatusDot className="bg-muted-foreground" />,
                    },
                ],
                onChange: (value) => onChange({...view, status: value as AutomationStatusFilter}),
            },
            {
                key: "agent",
                label: t("automations.screens.filterAgent"),
                icon: <Robot size={ICON} />,
                value: view.agent,
                options: [
                    {
                        value: "all",
                        label: t("automations.screens.filterAllAgents"),
                        icon: <Robot size={ICON} />,
                    },
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
                emptyText: t("automations.screens.filterNoAgents"),
                wide: true,
                onChange: (value) => onChange({...view, agent: value}),
            },
            {
                key: "group",
                label: t("automations.screens.filterGroupBy"),
                icon: <Rows size={ICON} />,
                block: "sort",
                value: view.group,
                options: [
                    {
                        value: "none",
                        label: t("automations.screens.groupNone"),
                        icon: <Minus size={ICON} />,
                    },
                    {
                        value: "type",
                        label: t("automations.screens.filterType"),
                        icon: <Lightning size={ICON} />,
                    },
                    {
                        value: "status",
                        label: t("automations.screens.filterStatus"),
                        icon: <Waveform size={ICON} />,
                    },
                    {
                        value: "agent",
                        label: t("automations.screens.filterAgent"),
                        icon: <Robot size={ICON} />,
                    },
                ],
                onChange: (value) => onChange({...view, group: value as AutomationGrouping}),
            },
        ],
        [agents, onChange, t, view],
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
            // The mode survives a reset: it is how the reader chose to read the list, not what
            // they narrowed it to.
            onReset={() => onChange({...DEFAULT_AUTOMATION_LIST_VIEW, mode: view.mode})}
            resetDisabled={isDefaultAutomationListView(view)}
        />
    )
}
