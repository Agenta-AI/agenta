import type {SidebarConfig} from "@agenta/navigation"

import {developerNavItems, developerRailItems} from "../developer/developerNavItems"
import type {DeveloperView} from "../developer/developerViews"

import {observabilityNavItems, tNow, type NavTranslate} from "./observabilityNavItems"

/** The developer rows, by where they go in the main rail. */
export interface DeveloperNavSlots {
    /** After Home and Builder. */
    afterHome: SidebarConfig[]
    /** After Sessions, at the end of the main section. */
    afterSessions: SidebarConfig[]
}

/**
 * Beta developer mode gets the old app's layout; without beta the rail stays as it was. Prompts
 * is a plain row: its page already lists every prompt.
 */
export const developerNavSlots = (
    projectURL: string,
    views: readonly DeveloperView[],
    developerMode: boolean,
    t: NavTranslate = tNow,
): DeveloperNavSlots => {
    if (!developerMode) {
        return {afterHome: [], afterSessions: developerNavItems(projectURL, views, t)}
    }
    const rail = developerRailItems(projectURL, views, t)
    return {
        afterHome: rail.lead,
        afterSessions: [...rail.evaluation, ...observabilityNavItems(projectURL, true, t)],
    }
}
