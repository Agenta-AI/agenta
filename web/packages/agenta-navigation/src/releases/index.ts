import changelogData from "./changelog.json"

/** One shipped release, newest first. `link` opens the changelog entry. */
export interface ReleaseEntry {
    id: string
    title: string
    description: string
    link?: string
    /** Cloudflare Stream demo clip for this release (same account as the docs embeds). */
    streamVideoId?: string
}

/** Where "View all releases" goes. */
export const ALL_RELEASES_LINK = "https://agenta.ai/docs/changelog"

/**
 * The releases the help menu lists under "What's new?".
 *
 * These used to be sidebar banner cards, one dismissal at a time. A release is news, not a
 * task: it belongs in a list you open, not in a card you have to clear.
 */
export const RELEASES: ReleaseEntry[] = changelogData as ReleaseEntry[]

export {
    computeUnseenReleases,
    getUnseenReleases,
    markAllReleasesSeen,
    QUIET_PERIOD_MS,
    WHATS_NEW_FIRST_VISIT_KEY,
    WHATS_NEW_SEEN_KEY,
} from "./seen"
