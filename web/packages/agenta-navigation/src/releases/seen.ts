import {RELEASES, type ReleaseEntry} from "./index"

/**
 * The what's-new seen state: which releases count as NEWS for this browser.
 *
 * Two rules keep announcements from overwhelming anyone (see the feature-awareness
 * research, 2026-09-30):
 *
 * 1. **Seeded at first visit.** On the first visit every release already in the list is
 *    stored as seen — a release that shipped before the user arrived is not news to
 *    them, it is just the product. Only releases added AFTER the first visit surface.
 * 2. **A quiet period.** For the first days after the first visit no push surface shows
 *    at all, even for releases that ship inside it; they queue and appear afterwards.
 *    A brand-new user is still learning the product — the pull surface (the help menu's
 *    "What's new?" list) stays available the whole time.
 *
 * Seen ids are a SET, not a pointer: `changelog.json` is curated, not strictly
 * date-sorted, so "above the last seen entry" would not mean "newer". Storage is per
 * browser (localStorage), the same durability the dismissed sidebar banners had.
 */

export const WHATS_NEW_SEEN_KEY = "agenta-whats-new-seen-ids"
export const WHATS_NEW_FIRST_VISIT_KEY = "agenta-whats-new-first-visit"

/** How long after the first visit the push surface stays quiet. */
export const QUIET_PERIOD_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The pure core, separated so the scenarios are testable without a DOM: given the
 * release list, the stored seen ids, the first-visit time and now, which releases
 * should the push surface show?
 */
export const computeUnseenReleases = ({
    releases,
    seenIds,
    firstVisitAt,
    now,
}: {
    releases: ReleaseEntry[]
    /** Ids stored as seen, or null when nothing was stored yet (first visit). */
    seenIds: string[] | null
    /** When this browser first opened the app, or null when nothing was stored. */
    firstVisitAt: number | null
    now: number
}): ReleaseEntry[] => {
    // Nothing stored yet: this is the first visit. Everything that already shipped is
    // the product, not news — the caller seeds the store and shows nothing.
    if (seenIds === null || firstVisitAt === null) return []

    // Quiet period: push nothing while the user is still in the learning phase.
    if (now - firstVisitAt < QUIET_PERIOD_MS) return []

    const seen = new Set(seenIds)
    return releases.filter((release) => !seen.has(release.id))
}

const readSeenIds = (): string[] | null => {
    if (typeof window === "undefined") return null
    const raw = window.localStorage.getItem(WHATS_NEW_SEEN_KEY)
    if (raw === null) return null
    try {
        const parsed = JSON.parse(raw) as unknown
        return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : null
    } catch {
        return null
    }
}

const readFirstVisit = (): number | null => {
    if (typeof window === "undefined") return null
    const raw = window.localStorage.getItem(WHATS_NEW_FIRST_VISIT_KEY)
    if (raw === null) return null
    const parsed = Number(raw)
    return Number.isNaN(parsed) ? null : parsed
}

const write = (key: string, value: string) => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(key, value)
}

/**
 * The releases the push surface (home card) should show right now. Seeds the seen store
 * on the first call in a fresh browser, so the first visit always returns [].
 */
export const getUnseenReleases = (now: number = Date.now()): ReleaseEntry[] => {
    const seenIds = readSeenIds()
    const firstVisitAt = readFirstVisit()

    if (seenIds === null || firstVisitAt === null) {
        markAllReleasesSeen()
        write(WHATS_NEW_FIRST_VISIT_KEY, String(now))
        return []
    }
    return computeUnseenReleases({releases: RELEASES, seenIds, firstVisitAt, now})
}

/**
 * Store every release currently in the list as seen. The list in the repo is capped, so
 * the union stays small; keeping previously stored ids means an entry that later drops
 * out of the cap and returns does not resurface as news.
 */
export const markAllReleasesSeen = () => {
    const previous = readSeenIds() ?? []
    const union = new Set([...previous, ...RELEASES.map((release) => release.id)])
    write(WHATS_NEW_SEEN_KEY, JSON.stringify([...union]))
}
