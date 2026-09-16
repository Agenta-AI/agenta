import {useMemo} from "react"

import {FilterMenu, type FilterMenuItem} from "@agenta/ui/filter-menu"
import {
    Archive,
    Folder,
    GitBranch,
    Minus,
    Robot,
    Rows,
    SquaresFour,
    Stack,
} from "@phosphor-icons/react"

import {
    ALL_SOURCES,
    DEFAULT_SKILL_LIST_VIEW,
    isDefaultSkillFilters,
    PROJECT_LABEL,
    PROJECT_SOURCE,
    type SkillGrouping,
    type SkillListView,
    type SkillUsedByFilter,
} from "./skillListView"

const ICON = 14

/**
 * The skills registry's single view control: where a skill came from, whether an agent runs
 * it, the agents menu's "Only archived" switch, then how the rows are cut.
 *
 * Everything the shared `FilterMenu` knows about this screen arrives as props, so the package
 * never learns what a skill is and this file never re-implements a row or a check mark.
 */
export const SkillFilterMenu = ({
    view,
    onChange,
    repositories,
}: {
    view: SkillListView
    onChange: (view: SkillListView) => void
    /** The repositories the rows were imported from, in display order. */
    repositories: string[]
}) => {
    const sections = useMemo<FilterMenuItem[]>(
        () => [
            {
                key: "source",
                label: "Source",
                icon: <Stack size={ICON} />,
                value: view.source,
                wide: true,
                options: [
                    {value: ALL_SOURCES, label: "All sources", icon: <SquaresFour size={ICON} />},
                    {value: PROJECT_SOURCE, label: PROJECT_LABEL, icon: <Folder size={ICON} />},
                    ...repositories.map((repository) => ({
                        value: repository,
                        label: repository,
                        icon: <GitBranch size={ICON} />,
                    })),
                ],
                onChange: (value) => onChange({...view, source: value}),
            },
            {
                key: "usedBy",
                label: "Used by",
                icon: <Robot size={ICON} />,
                value: view.usedBy,
                options: [
                    {value: "any", label: "Any agent", icon: <SquaresFour size={ICON} />},
                    {value: "used", label: "Used by an agent", icon: <Robot size={ICON} />},
                    {value: "unused", label: "Not used yet", icon: <Minus size={ICON} />},
                ],
                onChange: (value) => onChange({...view, usedBy: value as SkillUsedByFilter}),
            },
            {
                kind: "toggle",
                key: "archived",
                label: "Only archived",
                icon: <Archive size={ICON} />,
                checked: view.archived,
                onChange: (checked) => onChange({...view, archived: checked}),
            },
            {
                key: "group",
                label: "Group by",
                icon: <Rows size={ICON} />,
                block: "sort",
                value: view.group,
                options: [
                    {value: "none", label: "None", icon: <Minus size={ICON} />},
                    {value: "source", label: "Source", icon: <Stack size={ICON} />},
                ],
                onChange: (value) => onChange({...view, group: value as SkillGrouping}),
            },
        ],
        [onChange, repositories, view],
    )

    // The grouping and the view mode survive a reset: they are how the reader chose to read the
    // list, not what they narrowed it to.
    const isDefault = isDefaultSkillFilters(view) && view.group === DEFAULT_SKILL_LIST_VIEW.group

    return (
        <FilterMenu
            sections={sections}
            align="start"
            // Icon alone: the list beside it is already the subject, as on the agents toolbar.
            label={null}
            triggerAriaLabel="Filter skills"
            size="default"
            // The view toggle beside it is 32; a 28px funnel between them read as a mistake.
            triggerClassName="size-8"
            active={!isDefaultSkillFilters(view)}
            onReset={() => onChange({...DEFAULT_SKILL_LIST_VIEW, mode: view.mode})}
            resetDisabled={isDefault}
        />
    )
}
