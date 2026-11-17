import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import automationsModelCatalog from "@agenta/i18n/catalogs/automations.model"
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
    const t = useT(automationsEditorCatalog, automationsModelCatalog)
    const sections = useMemo<FilterMenuSection[]>(
        () => [
            {
                key: "status",
                label: t("automations.editor.filterStatus"),
                icon: <Waveform size={ICON} />,
                value: view.status,
                options: [
                    {
                        value: "all",
                        label: t("automations.editor.filterAll"),
                        icon: <SquaresFour size={ICON} />,
                    },
                    {
                        value: "ok",
                        label: t("automations.model.outcomeSucceeded"),
                        icon: <CheckCircle size={ICON} className="text-success" />,
                    },
                    {
                        value: "bad",
                        label: t("automations.model.outcomeFailed"),
                        icon: <WarningCircle size={ICON} className="text-destructive" />,
                    },
                    {
                        value: "pending",
                        label: t("automations.model.outcomeRunning"),
                        icon: <Circle size={ICON} className="text-muted-foreground" />,
                    },
                ],
                onChange: (next) => onChange({...view, status: next as RunStatusFilter}),
            },
            {
                key: "type",
                label: t("automations.editor.filterType"),
                icon: <Lightning size={ICON} />,
                value: view.type,
                options: [
                    {
                        value: "all",
                        label: t("automations.editor.filterAll"),
                        icon: <SquaresFour size={ICON} />,
                    },
                    {
                        value: "scheduled",
                        label: t("automations.model.runTypeScheduled"),
                        icon: <ClockClockwise size={ICON} />,
                    },
                    {
                        value: "event",
                        label: t("automations.model.runTypeEvent"),
                        icon: <Lightning size={ICON} />,
                    },
                    {
                        value: "test",
                        label: t("automations.model.runTest"),
                        icon: <Flask size={ICON} />,
                    },
                ],
                onChange: (next) => onChange({...view, type: next as RunTypeFilter}),
            },
            {
                key: "group",
                label: t("automations.editor.filterGroupBy"),
                icon: <Rows size={ICON} />,
                block: "sort",
                value: view.group,
                options: [
                    {
                        value: "day",
                        label: t("automations.editor.groupDay"),
                        icon: <CalendarBlank size={ICON} />,
                    },
                    {
                        value: "status",
                        label: t("automations.editor.filterStatus"),
                        icon: <Waveform size={ICON} />,
                    },
                    {
                        value: "type",
                        label: t("automations.editor.filterType"),
                        icon: <Lightning size={ICON} />,
                    },
                    {
                        value: "none",
                        label: t("automations.editor.groupNone"),
                        icon: <Minus size={ICON} />,
                    },
                ],
                onChange: (next) => onChange({...view, group: next as RunGrouping}),
            },
        ],
        [onChange, t, view],
    )

    return (
        <FilterMenu
            sections={sections}
            // The list is a 240px column: the panel opens under the button's right edge so it
            // does not hang off the rule beside it. The flyouts keep their default side —
            // Radix flips them when the column leaves no room.
            align="end"
            searchPlaceholder={t("automations.editor.searchFilters")}
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
