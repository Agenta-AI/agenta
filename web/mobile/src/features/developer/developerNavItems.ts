import {createElement} from "react"

import type {SidebarConfig} from "@agenta/navigation"
import {CodeIcon} from "@phosphor-icons/react"

import type {DeveloperNavSection, DeveloperView} from "./developerViews"

const SECTION_TITLES: Record<DeveloperNavSection, string> = {developer: "Developer"}

/**
 * One rail section per nav section that has an enabled view, or nothing at all. Links never
 * prefetch: a developer view's code must not load on the pages every user opens.
 */
export const developerNavItems = (
    projectURL: string,
    views: readonly DeveloperView[],
): SidebarConfig[] =>
    (Object.keys(SECTION_TITLES) as DeveloperNavSection[]).flatMap((section) => {
        const rows = views.flatMap(({id, label, routes, nav}) =>
            routes && nav?.section === section ? [{id, label, path: routes[0], nav}] : [],
        )
        if (rows.length === 0) return []
        return [
            {
                key: `developer-section-${section}`,
                title: SECTION_TITLES[section],
                icon: createElement(CodeIcon, {size: 16}),
                // A section, not a fold: no caret, and no persisted open state to start closed.
                alwaysOpen: true,
                submenu: rows.map(({id, label, path, nav}) => ({
                    key: `developer-view-${id}`,
                    title: label,
                    icon: createElement(nav.icon, {size: 16}),
                    link: `${projectURL}${path}`,
                    prefetch: false,
                })),
            },
        ]
    })
