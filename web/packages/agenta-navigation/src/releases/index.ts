import changelogData from "./changelog.json"

export interface ReleaseItem {
    area: string
    text: string
}

export interface ReleaseFeature {
    /** The docs entry slug. */
    id: string
    title: string
    /** Markdown from the entry's `<Summary>`, with docs links made absolute. */
    body: string
    link: string
    /** Cloudflare Stream demo clip (same account as the docs embeds). */
    streamVideoId?: string
}

/** Every docs changelog entry that shares one version tag. */
export interface Release {
    /** The version tag, e.g. "v0.125.0". */
    id: string
    /** YYYY-MM-DD, the newest entry's date. */
    date: string
    features: ReleaseFeature[]
    improvements: ReleaseItem[]
    fixes: ReleaseItem[]
    /** Set when an entry of this version has the docs tag "security". */
    securityFix?: true
}

/** A message from the release feed, shown only where every filter matches. */
export interface Notice {
    id: string
    title: string
    body: string
    link: string
    severity: "info" | "warning"
    editions?: ("oss" | "ee")[]
    /** Plan slugs, e.g. "self_hosted_community". */
    plans?: string[]
    /** Inclusive, in the `Release.id` form. */
    minVersion?: string
    maxVersion?: string
}

/** The published feed at https://agenta.ai/releases.json. */
export interface ReleaseFeed {
    releases: Release[]
    notices: Notice[]
}

/** `GET /instance/releases`: the feed as the API cached it, and the running version. */
export interface InstanceReleases extends ReleaseFeed {
    version: string
}

/** Where "View all releases" goes. */
export const ALL_RELEASES_LINK = "https://agenta.ai/docs/changelog"

/** The self-hosting upgrade guide. */
export const UPGRADE_GUIDE_LINK = "https://agenta.ai/docs/self-host/upgrading"

/** Newest first. Generated from docs/blog/entries by `pnpm generate:releases`; do not hand-edit. */
export const RELEASES: Release[] = changelogData as Release[]

export {
    compareVersions,
    isVersion,
    latestSecurityRelease,
    mergeReleases,
    newerReleases,
    noticeApplies,
    parseNotices,
} from "./feed"
export {
    dismissNotice as dismissReleaseNotice,
    dismissSecurityWarning,
    getDismissedNoticeIds,
    isSecurityWarningDismissed,
} from "./dismissed"
export {
    feedNoticesAtom,
    instanceReleasesQueryAtom,
    releaseListAtom,
    runningVersionAtom,
} from "./state"
export {
    getUnseenReleases,
    isWhatsNewOptedOut,
    markAllReleasesSeen,
    setWhatsNewOptedOut,
} from "./seen"
