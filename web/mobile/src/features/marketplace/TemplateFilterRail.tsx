import {useState} from "react"

import {Button, Checkbox} from "@agenta/ui/ui"

import {AppTile} from "./AppTile"
import type {AppFacet, FacetCount, MarketplaceFilter} from "./marketplaceView"
import {SectionLabel} from "./SectionLabel"

const APPS_SHOWN = 6

/** The catalog's facets as a sidebar, from `lg`: one category, any number of apps. */
export const TemplateFilterRail = ({
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
    const [showAllApps, setShowAllApps] = useState(false)
    // A checked app stays listed even when it falls past the cut.
    const shownApps = showAllApps
        ? apps
        : apps.filter((facet, index) => index < APPS_SHOWN || filter.apps.includes(facet.app.slug))

    const toggleApp = (slug: string, checked: boolean) =>
        onChange({
            ...filter,
            apps: checked ? [...filter.apps, slug] : filter.apps.filter((value) => value !== slug),
        })

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-0.5">
                <SectionLabel id="template-category-label" className="px-2.5">
                    Category
                </SectionLabel>
                <div
                    role="radiogroup"
                    aria-labelledby="template-category-label"
                    className="mt-1.5 flex flex-col gap-0.5"
                >
                    {categories.map((item) => {
                        const active = item.value === filter.category
                        return (
                            <Button
                                key={item.value}
                                role="radio"
                                aria-checked={active}
                                variant={active ? "secondary" : "ghost"}
                                size="sm"
                                onClick={() => onChange({...filter, category: item.value})}
                                className="w-full justify-between"
                            >
                                <span className="min-w-0 truncate">{item.label}</span>
                                <span className="text-muted-foreground shrink-0 text-xs">
                                    {item.count}
                                </span>
                            </Button>
                        )
                    })}
                </div>
            </div>

            {apps.length ? (
                <div
                    role="group"
                    aria-labelledby="template-apps-label"
                    className="flex flex-col gap-0.5"
                >
                    <div className="flex items-center justify-between pr-2.5">
                        <SectionLabel id="template-apps-label" className="px-2.5">
                            Apps
                        </SectionLabel>
                        {filter.apps.length ? (
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => onChange({...filter, apps: []})}
                            >
                                Clear
                            </Button>
                        ) : null}
                    </div>
                    <div className="mt-1.5 flex flex-col gap-0.5">
                        {shownApps.map(({app, count}) => {
                            const checked = filter.apps.includes(app.slug)
                            return (
                                <label
                                    key={app.slug}
                                    className="box-border flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground transition-colors hover:bg-accent/60"
                                >
                                    <Checkbox
                                        checked={checked}
                                        onCheckedChange={(value) =>
                                            toggleApp(app.slug, value === true)
                                        }
                                    />
                                    <AppTile app={app} size="xs" decorative />
                                    <span className="min-w-0 flex-1 truncate">{app.name}</span>
                                    <span className="text-placeholder shrink-0 text-xs">
                                        {count}
                                    </span>
                                </label>
                            )
                        })}
                        {apps.length > APPS_SHOWN ? (
                            <Button
                                variant="ghost"
                                size="xs"
                                aria-expanded={showAllApps}
                                onClick={() => setShowAllApps((value) => !value)}
                                className="self-start"
                            >
                                {showAllApps ? "Show fewer" : `Show all ${apps.length}`}
                            </Button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    )
}
