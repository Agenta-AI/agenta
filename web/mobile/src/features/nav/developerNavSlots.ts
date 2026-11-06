import type {SidebarConfig} from "@agenta/navigation"

import {developerNavItems, developerRailItems} from "../developer/developerNavItems"
import type {DeveloperView} from "../developer/developerViews"

import {observabilityNavItems} from "./observabilityNavItems"

/** The developer rows, by where they go in the main rail. */
export interface DeveloperNavSlots {
    /** Right after Home. */
    afterHome: SidebarConfig[]
    /** After Sessions, at the end of the main section. */
    afterSessions: SidebarConfig[]
}

/** Beta developer mode gets the old app's layout; without beta the rail stays as it was. */
export const developerNavSlots = (
    projectURL: string,
    views: readonly DeveloperView[],
    developerMode: boolean,
): DeveloperNavSlots => {
    if (!developerMode) {
        return {afterHome: [], afterSessions: developerNavItems(projectURL, views)}
    }
    const rail = developerRailItems(projectURL, views)
    return {
        afterHome: rail.lead,
        afterSessions: [
            ...rail.evaluation,
            ...observabilityNavItems(projectURL, true),
            ...rail.trail,
        ],
    }
}
