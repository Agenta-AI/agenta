import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {FilterMenu, type FilterMenuItem} from "@agenta/ui/filter-menu"
import {
    Archive,
    Asterisk,
    FolderSimple,
    GitBranch,
    Minus,
    Robot,
    Rows,
    Stack,
} from "@phosphor-icons/react"

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

/** The skills list's filter menu: source, used by, only archived, and group by. */
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
                defaultValue: DEFAULT_SKILL_LIST_VIEW.source,
                wide: true,
                options: [
                    {
                        value: ALL_SOURCES,
                        label: t("skills.list.filterAllSources"),
                        icon: <Asterisk size={ICON} />,
                    },
                    {
                        value: PROJECT_SOURCE,
                        label: projectLabel(),
                        icon: <FolderSimple size={ICON} />,
                    },
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
                defaultValue: DEFAULT_SKILL_LIST_VIEW.usedBy,
                options: [
                    {
                        value: "any",
                        label: t("skills.list.filterAnyAgent"),
                        icon: <Asterisk size={ICON} />,
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
                kind: "toggle",
                key: "archived",
                label: t("skills.list.filterOnlyArchived"),
                icon: <Archive size={ICON} />,
                checked: view.archived,
                onChange: (checked) => onChange({...view, archived: checked}),
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

    const isDefault = isDefaultSkillFilters(view)

    return (
        <FilterMenu
            sections={sections}
            align="start"
            size="default"
            onReset={() =>
                // A reset keeps the grouping and the view mode.
                onChange({...DEFAULT_SKILL_LIST_VIEW, group: view.group, mode: view.mode})
            }
            resetDisabled={isDefault}
        />
    )
}
