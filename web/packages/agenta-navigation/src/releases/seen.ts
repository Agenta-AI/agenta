import {RELEASES, type ReleaseEntry} from "./index"

// Seen ids are a set, not a pointer: changelog.json is curated, not date-sorted.
const WHATS_NEW_SEEN_KEY = "agenta-whats-new-seen-ids"
const WHATS_NEW_OPTED_OUT_KEY = "agenta-whats-new-opted-out"

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

/** Store every listed release as seen, keeping older ids so a returning entry stays seen. */
export const markAllReleasesSeen = () => {
    const previous = readSeenIds() ?? []
    const union = new Set([...previous, ...RELEASES.map((release) => release.id)])
    writeStorage(WHATS_NEW_SEEN_KEY, JSON.stringify([...union]))
}

/** Whether the user asked never to have the modal open on its own again. */
export const isWhatsNewOptedOut = (): boolean => readStorage(WHATS_NEW_OPTED_OUT_KEY) === "true"

export const setWhatsNewOptedOut = (optedOut: boolean) =>
    writeStorage(WHATS_NEW_OPTED_OUT_KEY, optedOut ? "true" : null)
