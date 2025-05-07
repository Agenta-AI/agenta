import {NextRouter} from "next/router"

/**
 * Extracts revision IDs from URL parameters
 * @param router Next.js router instance
 * @returns Array of revision IDs
 */
export function getRevisionIdsFromUrl(router: NextRouter): string[] {
    if (!router.query.revisions) return []

    try {
        if (typeof router.query.revisions === "string") {
            return JSON.parse(router.query.revisions)
        }
    } catch (e) {
        console.error("Error parsing revisions from URL", e)
    }

    return []
}
