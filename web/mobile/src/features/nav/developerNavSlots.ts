import type {SidebarConfig} from "@agenta/navigation"

import {
    developerNavItems,
    developerRailItems,
    developerRowKey,
} from "../developer/developerNavItems"
import type {DeveloperView} from "../developer/developerViews"

import {observabilityNavItems} from "./observabilityNavItems"

/** The Prompts row's key: the prompt apps load under it when it opens. */
export const PROMPTS_ROW_KEY = developerRowKey("prompts")

/** The developer rows, by where they go in the main rail. */
export interface DeveloperNavSlots {
    /** Right after Home. */
    afterHome: SidebarConfig[]
    /** After Sessions, at the end of the main section. */
    afterSessions: SidebarConfig[]
}

/**
 * Beta developer mode gets the old app's layout, with `promptsChildren` (the prompt apps) under
 * Prompts; without beta the rail stays as it was.
 */
export const developerNavSlots = (
    projectURL: string,
    views: readonly DeveloperView[],
    developerMode: boolean,
    promptsChildren: SidebarConfig[] = [],
): DeveloperNavSlots => {
    if (!developerMode) {
        return {afterHome: [], afterSessions: developerNavItems(projectURL, views)}
    }
    const rail = developerRailItems(projectURL, views)
    return {
        // Collapsed, Prompts opens its page rather than a flyout of apps, as in the old app.
        afterHome: rail.lead.map((row) =>
            row.key === PROMPTS_ROW_KEY && promptsChildren.length
                ? {...row, submenu: promptsChildren, hideChildrenWhenCollapsed: true}
                : row,
        ),
        afterSessions: [...rail.evaluation, ...observabilityNavItems(projectURL, true)],
    }
}
