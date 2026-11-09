// Same storage rules as seen.ts: blocked storage means the notice may show again, never a crash.
const DISMISSED_NOTICES_KEY = "agenta-release-notices-dismissed"
const SECURITY_WARNING_KEY = "agenta-security-warning-dismissed"

/** A closed security warning comes back after this long while the instance is still behind. */
export const SECURITY_WARNING_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

const read = (key: string): unknown => {
    if (typeof window === "undefined") return null
    try {
        const raw = window.localStorage.getItem(key)
        return raw === null ? null : (JSON.parse(raw) as unknown)
    } catch {
        return null
    }
}

const write = (key: string, value: unknown) => {
    if (typeof window === "undefined") return
    try {
        window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
        // Not persisted: the notice shows again on the next load.
    }
}

/** Ids of the feed notices closed in this browser. */
export const getDismissedNoticeIds = (): string[] => {
    const stored = read(DISMISSED_NOTICES_KEY)
    return Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []
}

export const dismissNotice = (id: string) =>
    write(DISMISSED_NOTICES_KEY, [...new Set([...getDismissedNoticeIds(), id])])

/** The pure core: a warning for `releaseId` closed less than seven days before `now`. */
export const isSecurityWarningSnoozed = ({
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

export const isSecurityWarningDismissed = (releaseId: string, now = Date.now()): boolean =>
    isSecurityWarningSnoozed({stored: read(SECURITY_WARNING_KEY), releaseId, now})

export const dismissSecurityWarning = (releaseId: string, now = Date.now()) =>
    write(SECURITY_WARNING_KEY, {id: releaseId, at: now})
