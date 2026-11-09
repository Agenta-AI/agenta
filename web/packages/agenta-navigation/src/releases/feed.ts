import type {Notice, Release} from "./index"

const VERSION = /^v(\d+)\.(\d+)\.(\d+)$/

/** Whether `value` has the `Release.id` form, e.g. "v0.128.11". */
export const isVersion = (value: unknown): value is string =>
    typeof value === "string" && VERSION.test(value)

/** Compares by number, so v0.128.10 is newer than v0.128.9. Negative when `a` is older. */
export const compareVersions = (a: string, b: string): number => {
    const x = VERSION.exec(a)
    const y = VERSION.exec(b)
    if (!x || !y) throw new Error(`Not a version: ${x ? b : a}`)
    for (let i = 1; i <= 3; i++) {
        const diff = Number(x[i]) - Number(y[i])
        if (diff !== 0) return diff
    }
    return 0
}

// The feed is remote data: bound what it may hold, and drop an entry the dialog cannot render
// rather than draw it half.
const MAX_FEED_RELEASES = 50
const MAX_FEED_NOTICES = 10
const MAX_LIST_LENGTH = 50
const MAX_TITLE_LENGTH = 300
const MAX_BODY_LENGTH = 20_000

const isText = (value: unknown, max: number): value is string =>
    typeof value === "string" && value.length <= max

const isHttpsLink = (value: unknown): value is string =>
    isText(value, 2_000) && /^https:\/\/[^\s]+$/.test(value)

const isReleaseItem = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false
    const item = value as {area?: unknown; text?: unknown}
    return isText(item.area, MAX_TITLE_LENGTH) && isText(item.text, MAX_BODY_LENGTH)
}

const isRelease = (value: unknown): value is Release => {
    if (!value || typeof value !== "object") return false
    const release = value as Partial<Release>
    return (
        isVersion(release.id) &&
        isText(release.date, MAX_TITLE_LENGTH) &&
        Array.isArray(release.features) &&
        release.features.length > 0 &&
        release.features.length <= MAX_LIST_LENGTH &&
        release.features.every(
            (feature) =>
                isText(feature?.id, MAX_TITLE_LENGTH) &&
                isText(feature.title, MAX_TITLE_LENGTH) &&
                isText(feature.body, MAX_BODY_LENGTH) &&
                isHttpsLink(feature.link) &&
                (feature.streamVideoId === undefined ||
                    (typeof feature.streamVideoId === "string" &&
                        /^[A-Za-z0-9]{1,64}$/.test(feature.streamVideoId))),
        ) &&
        Array.isArray(release.improvements) &&
        release.improvements.length <= MAX_LIST_LENGTH &&
        release.improvements.every(isReleaseItem) &&
        Array.isArray(release.fixes) &&
        release.fixes.length <= MAX_LIST_LENGTH &&
        release.fixes.every(isReleaseItem) &&
        (release.securityFix === undefined || release.securityFix === true)
    )
}

/**
 * The bundled list plus the feed's releases it does not have, newest first. The bundled copy
 * of a release wins: it is what this build shipped.
 */
export const mergeReleases = (bundled: Release[], feed: readonly unknown[] = []): Release[] => {
    const known = new Set(bundled.map((release) => release.id))
    const added = feed
        .slice(0, MAX_FEED_RELEASES)
        .filter(isRelease)
        .filter((release) => {
            if (known.has(release.id)) return false
            known.add(release.id)
            return true
        })
    if (added.length === 0) return bundled
    return [...bundled, ...added].sort((a, b) => compareVersions(b.id, a.id))
}

/** Releases newer than the running version. None when the version is unknown. */
export const newerReleases = (releases: Release[], version: string | null): Release[] =>
    isVersion(version) ? releases.filter((release) => compareVersions(release.id, version) > 0) : []

/** The newest release with a security fix that the running version does not have yet. */
export const latestSecurityRelease = (
    releases: Release[],
    version: string | null,
): Release | null => newerReleases(releases, version).find((release) => release.securityFix) ?? null

/** Whether every filter the notice sets matches this instance. */
export const noticeApplies = (
    notice: Notice,
    {version, edition, plan}: {version: string | null; edition: "oss" | "ee"; plan: string | null},
): boolean => {
    if (notice.editions && !notice.editions.includes(edition)) return false
    if (notice.plans && !(plan && notice.plans.includes(plan))) return false
    if (notice.minVersion || notice.maxVersion) {
        if (!isVersion(version)) return false
        if (isVersion(notice.minVersion) && compareVersions(version, notice.minVersion) < 0)
            return false
        if (isVersion(notice.maxVersion) && compareVersions(version, notice.maxVersion) > 0)
            return false
    }
    return true
}

const NOTICE_SEVERITIES = new Set(["info", "warning"])

const isStringList = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string")

/** The feed's notices that are well formed; anything else is dropped. */
export const parseNotices = (feed: readonly unknown[] = []): Notice[] =>
    feed.slice(0, MAX_FEED_NOTICES).filter((value): value is Notice => {
        if (!value || typeof value !== "object") return false
        const notice = value as Partial<Notice>
        return (
            isText(notice.id, MAX_TITLE_LENGTH) &&
            isText(notice.title, MAX_TITLE_LENGTH) &&
            isText(notice.body, MAX_BODY_LENGTH) &&
            isHttpsLink(notice.link) &&
            NOTICE_SEVERITIES.has(notice.severity ?? "") &&
            (notice.editions === undefined || isStringList(notice.editions)) &&
            (notice.plans === undefined || isStringList(notice.plans)) &&
            (notice.minVersion === undefined || isVersion(notice.minVersion)) &&
            (notice.maxVersion === undefined || isVersion(notice.maxVersion))
        )
    })
