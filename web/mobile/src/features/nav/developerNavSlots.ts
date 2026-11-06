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

/**
 * Beta developer mode lays the developer rows out like the old app's rail: Prompts after Home,
 * then the Evaluation group, Observability and Registry after Sessions. Without beta the rail
 * keeps its flat Developer section after Sessions, exactly as before.
 */
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
