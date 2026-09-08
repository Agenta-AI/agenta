import {useMemo} from "react"

import {FilterMenu, type FilterMenuSection} from "@agenta/ui/filter-menu"
import {
    CalendarBlank,
    CheckCircle,
    Circle,
    ClockClockwise,
    Flask,
    Lightning,
    Minus,
    Rows,
    SquaresFour,
    WarningCircle,
    Waveform,
} from "@phosphor-icons/react"

import {
    DEFAULT_RUN_LIST_VIEW,
    isDefaultRunListView,
    type RunGrouping,
    type RunListView,
    type RunStatusFilter,
    type RunTypeFilter,
} from "./runListView"

const ICON = 14

/**
 * The run history's view control: how a run ended, how it started, and what the headings cut it
 * by.
 *
 * No Sort row: runs are newest-first everywhere in this app, and a history read bottom-up
 * answers no question the day headings do not already answer.
 */
export const AutomationRunFilterMenu = ({
    view,
    onChange,
}: {
    view: RunListView
    onChange: (view: RunListView) => void
}) => {
    const sections = useMemo<FilterMenuSection[]>(
        () => [
            {
                key: "status",
                label: "Status",
                icon: <Waveform size={ICON} />,
                value: view.status,
                options: [
                    {value: "all", label: "All", icon: <SquaresFour size={ICON} />},
                    {
                        value: "ok",
                        label: "Succeeded",
                        icon: <CheckCircle size={ICON} className="text-success" />,
                    },
                    {
                        value: "bad",
                        label: "Failed",
                        icon: <WarningCircle size={ICON} className="text-destructive" />,
                    },
                    {
                        value: "pending",
                        label: "Pending",
                        icon: <Circle size={ICON} className="text-muted-foreground" />,
                    },
                ],
                onChange: (next) => onChange({...view, status: next as RunStatusFilter}),
            },
            {
                key: "type",
                label: "Type",
                icon: <Lightning size={ICON} />,
                value: view.type,
                options: [
                    {value: "all", label: "All", icon: <SquaresFour size={ICON} />},
                    {
                        value: "scheduled",
                        label: "Scheduled",
                        icon: <ClockClockwise size={ICON} />,
                    },
                    {value: "event", label: "Event", icon: <Lightning size={ICON} />},
                    {value: "test", label: "Test run", icon: <Flask size={ICON} />},
                ],
                onChange: (next) => onChange({...view, type: next as RunTypeFilter}),
            },
            {
                key: "group",
                label: "Group by",
                icon: <Rows size={ICON} />,
                block: "sort",
                value: view.group,
                options: [
                    {value: "day", label: "Day", icon: <CalendarBlank size={ICON} />},
                    {value: "status", label: "Status", icon: <Waveform size={ICON} />},
                    {value: "type", label: "Type", icon: <Lightning size={ICON} />},
                    {value: "none", label: "None", icon: <Minus size={ICON} />},
                ],
                onChange: (next) => onChange({...view, group: next as RunGrouping}),
            },
        ],
        [onChange, view],
    )

    return (
        <FilterMenu
            sections={sections}
            // The list is a 240px column: the panel opens under the button's right edge so it
            // does not hang off the rule beside it. The flyouts keep their default side —
            // Radix flips them when the column leaves no room.
            align="end"
            searchPlaceholder="Search filters and group…"
            label={null}
            size="sm"
            // Ghost: it sits beside a heading rather than in a toolbar, and a bordered box
            // there reads as a second thing on the line with the title.
            variant="ghost"
            active={!isDefaultRunListView(view)}
            onReset={() => onChange(DEFAULT_RUN_LIST_VIEW)}
            resetDisabled={isDefaultRunListView(view)}
        />
    )
}
