import {readStorage, writeStorage} from "./seen"

const DISMISSED_NOTICES_KEY = "agenta-release-notices-dismissed"
const SECURITY_WARNING_KEY = "agenta-security-warning-dismissed"

/** A closed security warning comes back after this long while the instance is still behind. */
export const SECURITY_WARNING_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

const readJson = (key: string): unknown => {
    const raw = readStorage(key)
    if (raw === null) return null
    try {
        return JSON.parse(raw) as unknown
    } catch {
        return null
    }
}

/** Ids of the release notices closed in this browser. Closed is for good. */
export const getDismissedReleaseNoticeIds = (): string[] => {
    const stored = readJson(DISMISSED_NOTICES_KEY)
    return Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []
}

export const dismissReleaseNotice = (id: string) =>
    writeStorage(
        DISMISSED_NOTICES_KEY,
        JSON.stringify([...new Set([...getDismissedReleaseNoticeIds(), id])]),
    )

/** The pure core: a warning for `releaseId` closed less than seven days before `now`. */
export const isSnoozeActive = ({
    stored,
    releaseId,
    now,
}: {
    stored: unknown
    releaseId: string
    now: number
}): boolean => {
    if (!stored || typeof stored !== "object") return false
    const {id, at} = stored as {id?: unknown; at?: unknown}
    return id === releaseId && typeof at === "number" && now - at < SECURITY_WARNING_SNOOZE_MS
}

export const isSecurityWarningSnoozed = (releaseId: string, now = Date.now()): boolean =>
    isSnoozeActive({stored: readJson(SECURITY_WARNING_KEY), releaseId, now})

export const snoozeSecurityWarning = (releaseId: string, now = Date.now()) =>
    writeStorage(SECURITY_WARNING_KEY, JSON.stringify({id: releaseId, at: now}))
