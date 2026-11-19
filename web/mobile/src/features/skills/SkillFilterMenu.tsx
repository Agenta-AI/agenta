import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {FilterMenu, type FilterMenuItem} from "@agenta/ui/filter-menu"
import {Folder, GitBranch, Minus, Robot, Rows, SquaresFour, Stack} from "@phosphor-icons/react"

import {
    ALL_SOURCES,
    DEFAULT_SKILL_LIST_VIEW,
    isDefaultSkillFilters,
    projectLabel,
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
    const t = useT(skillsListCatalog)
    const sections = useMemo<FilterMenuItem[]>(
        () => [
            {
                key: "source",
                label: t("skills.list.filterSource"),
                icon: <Stack size={ICON} />,
                value: view.source,
                wide: true,
                options: [
                    {
                        value: ALL_SOURCES,
                        label: t("skills.list.filterAllSources"),
                        icon: <SquaresFour size={ICON} />,
                    },
                    {value: PROJECT_SOURCE, label: projectLabel(), icon: <Folder size={ICON} />},
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
                label: t("skills.list.filterUsedBy"),
                icon: <Robot size={ICON} />,
                value: view.usedBy,
                options: [
                    {
                        value: "any",
                        label: t("skills.list.filterAnyAgent"),
                        icon: <SquaresFour size={ICON} />,
                    },
                    {
                        value: "used",
                        label: t("skills.list.filterUsedByAgent"),
                        icon: <Robot size={ICON} />,
                    },
                    {
                        value: "unused",
                        label: t("skills.list.filterNotUsed"),
                        icon: <Minus size={ICON} />,
                    },
                ],
                onChange: (value) => onChange({...view, usedBy: value as SkillUsedByFilter}),
            },
            {
                key: "group",
                label: t("skills.list.filterGroupBy"),
                icon: <Rows size={ICON} />,
                block: "sort",
                value: view.group,
                options: [
                    {
                        value: "none",
                        label: t("skills.list.groupNone"),
                        icon: <Minus size={ICON} />,
                    },
                    {
                        value: "source",
                        label: t("skills.list.filterSource"),
                        icon: <Stack size={ICON} />,
                    },
                ],
                onChange: (value) => onChange({...view, group: value as SkillGrouping}),
            },
        ],
        [onChange, repositories, t, view],
    )

    // The grouping and the view mode survive a reset: they are how the reader chose to read the
    // list, not what they narrowed it to.
    const isDefault = isDefaultSkillFilters(view)

    return (
        <FilterMenu
            sections={sections}
            align="start"
            label="Filter"
            triggerAriaLabel="Filter skills"
            size="default"
            active={!isDefaultSkillFilters(view)}
            onReset={() =>
                onChange({
                    ...DEFAULT_SKILL_LIST_VIEW,
                    group: view.group,
                    mode: view.mode,
                    archived: view.archived,
                })
            }
            resetDisabled={isDefault}
        />
    )
}
