import {useMemo} from "react"

import {FilterMenu, type FilterMenuItem} from "@agenta/ui/filter-menu"
import {ArrowsDownUpIcon, SquaresFourIcon, TagIcon} from "@phosphor-icons/react"

import {AppTile} from "./AppTile"
import {
    DEFAULT_MARKETPLACE_FILTER,
    SORT_LABELS,
    isNarrowed,
    type AppFacet,
    type FacetCount,
    type MarketplaceFilter,
    type MarketplaceSort,
} from "./marketplaceView"

const ICON = 14

/** Below `lg` the sidebar's facets and the sort fold into the app's one filter control. */
export const TemplateFilterMenu = ({
    filter,
    onChange,
    categories,
    apps,
}: {
    filter: MarketplaceFilter
    onChange: (filter: MarketplaceFilter) => void
    categories: FacetCount[]
    apps: AppFacet[]
}) => {
    const sections = useMemo<FilterMenuItem[]>(
        () => [
            {
                key: "sort",
                label: "Sort",
                icon: <ArrowsDownUpIcon size={ICON} />,
                block: "sort",
                value: filter.sort,
                options: (Object.keys(SORT_LABELS) as MarketplaceSort[]).map((value) => ({
                    value,
                    label: SORT_LABELS[value],
                })),
                onChange: (value) => onChange({...filter, sort: value as MarketplaceSort}),
            },
            {
                key: "category",
                label: "Category",
                icon: <SquaresFourIcon size={ICON} />,
                value: filter.category,
                valueLabel: categories.find((item) => item.value === filter.category)?.label,
                options: categories.map((item) => ({
                    value: item.value,
                    label: `${item.label} (${item.count})`,
                })),
                onChange: (value) => onChange({...filter, category: value}),
            },
            {
                key: "apps",
                label: "Apps",
                icon: <TagIcon size={ICON} />,
                multi: true,
                value: filter.apps,
                valueLabel: filter.apps.length ? `${filter.apps.length} selected` : "Any",
                options: apps.map(({app, count}) => ({
                    value: app.slug,
                    label: `${app.name} (${count})`,
                    icon: <AppTile app={app} size="2xs" decorative />,
                })),
                onChange: (slug) =>
                    onChange({
                        ...filter,
                        apps: filter.apps.includes(slug)
                            ? filter.apps.filter((value) => value !== slug)
                            : [...filter.apps, slug],
                    }),
            },
        ],
        [apps, categories, filter, onChange],
    )
    const active = isNarrowed({...filter, query: ""}) || filter.sort !== "recommended"

    return (
        <FilterMenu
            sections={sections}
            align="end"
            label={null}
            triggerAriaLabel="Filter templates"
            size="default"
            triggerClassName="size-8"
            active={active}
            onReset={() => onChange({...DEFAULT_MARKETPLACE_FILTER, query: filter.query})}
            resetDisabled={!active}
        />
    )
}
