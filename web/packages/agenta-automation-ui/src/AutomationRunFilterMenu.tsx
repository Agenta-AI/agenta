import {useMemo} from "react"

import {FilterMenu, type FilterMenuSection} from "@agenta/ui/filter-menu"
import {
    ArrowsDownUp,
    CheckCircle,
    ClockClockwise,
    Circle,
    Flask,
    Lightning,
    SquaresFour,
    WarningCircle,
    Waveform,
} from "@phosphor-icons/react"

import {
    DEFAULT_RUN_LIST_VIEW,
    isDefaultRunListView,
    type RunKindFilter,
    type RunListView,
    type RunOutcomeFilter,
    type RunSort,
} from "./runListView"

const ICON = 14

/**
 * The run history's view control: how a run ended, how it started, and which end of the list to
 * read from.
 *
 * No Group row — the day headings are the list's presentation rather than a choice, and a menu
 * that offered to turn them off would be offering to make every row's bare time meaningless.
 * Omitting the section is the whole of that decision.
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
                key: "outcome",
                label: "Outcome",
                icon: <Waveform size={ICON} />,
                value: view.outcome,
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
                onChange: (next) => onChange({...view, outcome: next as RunOutcomeFilter}),
            },
            {
                key: "kind",
                label: "Kind",
                icon: <Lightning size={ICON} />,
                value: view.kind,
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
                onChange: (next) => onChange({...view, kind: next as RunKindFilter}),
            },
            {
                key: "sort",
                label: "Sort by",
                icon: <ArrowsDownUp size={ICON} />,
                block: "sort",
                value: view.sort,
                options: [
                    {value: "newest", label: "Newest first"},
                    {value: "oldest", label: "Oldest first"},
                ],
                onChange: (next) => onChange({...view, sort: next as RunSort}),
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
            searchPlaceholder="Search filters and sort…"
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
