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
}

/** Where "View all releases" goes. */
export const ALL_RELEASES_LINK = "https://agenta.ai/docs/changelog"

/** Newest first. Generated from docs/blog/entries by `pnpm generate:releases`; do not hand-edit. */
export const RELEASES: Release[] = changelogData as Release[]

export {
    getUnseenReleases,
    isWhatsNewOptedOut,
    markAllReleasesSeen,
    setWhatsNewOptedOut,
} from "./seen"
