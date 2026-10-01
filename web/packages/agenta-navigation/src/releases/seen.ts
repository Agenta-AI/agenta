import {RELEASES, type ReleaseEntry} from "./index"

/**
 * The what's-new seen state: which releases count as NEWS for this browser.
 *
 * Seeded at first visit: every release already in the list is stored as seen, because a
 * release that shipped before the user arrived is not news to them. Only releases added
 * after that surface, and each one surfaces once. Whether to push the modal at all
 * (existing user, not opted out) is the host's call; this module only answers "what is new".
 *
 * Seen ids are a SET, not a pointer: `changelog.json` is curated, not strictly
 * date-sorted, so "above the last seen entry" would not mean "newer". Storage is per
 * browser (localStorage).
 */

export const WHATS_NEW_SEEN_KEY = "agenta-whats-new-seen-ids"
export const WHATS_NEW_OPTED_OUT_KEY = "agenta-whats-new-opted-out"

/** The pure core: given the release list and the stored seen ids, which releases are new? */
export const computeUnseenReleases = ({
    releases,
    seenIds,
}: {
    releases: ReleaseEntry[]
    /** Ids stored as seen, or null when nothing was stored yet (first visit). */
    seenIds: string[] | null
}): ReleaseEntry[] => {
    // First visit: everything that already shipped is the product, not news.
    if (seenIds === null) return []
    const seen = new Set(seenIds)
    return releases.filter((release) => !seen.has(release.id))
}

// Storage can throw (private mode, blocked storage, quota); What's New then just stays quiet.
const readStorage = (key: string): string | null => {
    if (typeof window === "undefined") return null
    try {
        return window.localStorage.getItem(key)
    } catch {
        return null
    }
}

const writeStorage = (key: string, value: string | null) => {
    if (typeof window === "undefined") return
    try {
        if (value === null) window.localStorage.removeItem(key)
        else window.localStorage.setItem(key, value)
    } catch {
        // Not persisted: the modal may show again, which beats crashing it.
    }
}

const readSeenIds = (): string[] | null => {
    const raw = readStorage(WHATS_NEW_SEEN_KEY)
    if (raw === null) return null
    try {
        const parsed = JSON.parse(raw) as unknown
        return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : null
    } catch {
        return null
    }
}

/** The releases not yet seen in this browser. Seeds the store on the first call, which returns []. */
export const getUnseenReleases = (): ReleaseEntry[] => {
    const seenIds = readSeenIds()
    if (seenIds === null) {
        markAllReleasesSeen()
        return []
    }
    return computeUnseenReleases({releases: RELEASES, seenIds})
}

/**
 * Store every release currently in the list as seen. Keeping previously stored ids means an
 * entry that drops out of the capped list and returns does not resurface as news.
 */
export const markAllReleasesSeen = () => {
    const previous = readSeenIds() ?? []
    const union = new Set([...previous, ...RELEASES.map((release) => release.id)])
    writeStorage(WHATS_NEW_SEEN_KEY, JSON.stringify([...union]))
}

/** Whether the user asked never to have the modal open on its own again. */
export const isWhatsNewOptedOut = (): boolean => readStorage(WHATS_NEW_OPTED_OUT_KEY) === "true"

export const setWhatsNewOptedOut = (optedOut: boolean) =>
    writeStorage(WHATS_NEW_OPTED_OUT_KEY, optedOut ? "true" : null)
