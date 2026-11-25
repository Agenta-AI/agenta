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
    /** Absent when a feed entry's link is not https. */
    link?: string
    /** Cloudflare Stream demo clip (same account as the docs embeds). */
    streamVideoId?: string
    /** A picture drawn above the title, from the entry's `cover` frontmatter. Never set with a clip. */
    cover?: ReleaseCover
}

/** How big the newest missing update is: a security fix, a newer minor, or only patches. */
export type UpdateSize = "security" | "minor" | "patch"

/** The covers the What's new dialog can draw (see scripts/parse-entry.mjs). */
export type ReleaseCover = "builder" | "models" | "channels"

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
    /** Where this version's extra upgrade steps are, from the entry's `upgrade_notes`. */
    upgradeNotesLink?: string
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
    /** How the instance was deployed (AGENTA_DEPLOYMENT_METHOD); null when unknown. */
    deployment_method?: string | null
}

/** The deployment methods the upgrade box has commands for. */
export type UpgradeMethod = "compose" | "helm" | "railway"

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
    updateSize,
} from "./feed"
export {
    dismissReleaseNotice,
    getDismissedReleaseNoticeIds,
    isSecurityWarningSnoozed,
    snoozeSecurityWarning,
} from "./dismissed"
export {
    instanceReleasesQueryAtom,
    upgradeMethodAtom,
    notInstalledReleasesAtom,
    releaseListAtom,
    releaseNoticesAtom,
    runningVersionAtom,
    securityReleaseAtom,
    updateSizeAtom,
} from "./state"
export {
    getUnseenReleases,
    isWhatsNewOptedOut,
    markAllReleasesSeen,
    setWhatsNewOptedOut,
} from "./seen"
