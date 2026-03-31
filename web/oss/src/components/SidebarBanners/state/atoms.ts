import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import changelogData from "../data/changelog.json"
import {BannerConfig, BannerType} from "../types"

/**
 * Priority order for banner types.
 * Lower number = higher priority (shown first).
 *
 * Order: star-repo → changelog → upgrade → trial
 * This ensures new users see community/changelog banners first,
 * and billing-related banners only after engaging with the product.
 */
export const PRIORITY_ORDER: Record<BannerType, number> = {
    "star-repo": 0, // Highest priority - show first for new users
    changelog: 1,
    upgrade: 2,
    trial: 3, // Lowest priority - show after other banners are dismissed
}

/**
 * Persisted atom for dismissed banner IDs.
 * Uses localStorage to remember which banners the user has dismissed.
 */
export const dismissedBannerIdsAtom = atomWithStorage<string[]>("agenta:dismissed-banners", [])

/**
 * Action atom to dismiss a banner.
 * Adds the banner ID to the dismissed list.
 */
export const dismissBannerAtom = atom(null, (get, set, bannerId: string) => {
    const dismissed = get(dismissedBannerIdsAtom)
    if (!dismissed.includes(bannerId)) {
        set(dismissedBannerIdsAtom, [...dismissed, bannerId])
    }
})

/**
 * Star repo banner configuration.
 * Always available in both OSS and EE.
 */
const starRepoBanner: BannerConfig = {
    id: "star-repo-v1",
    type: "star-repo",
    dismissible: true,
    title: "Star Agenta",
    description: "Track new releases and join our growing community on GitHub.",
    action: {
        label: "Star on GitHub",
        href: "https://github.com/agenta-ai/agenta",
    },
}

/**
 * Get changelog banners from the JSON data file.
 * Each changelog entry becomes a separate dismissible banner.
 */
const getChangelogBanners = (): BannerConfig[] => {
    return (changelogData as {id: string; title: string; description: string; link?: string}[]).map(
        (entry) => ({
            id: entry.id,
            type: "changelog" as BannerType,
            dismissible: true,
            title: entry.title,
            description: entry.description,
            action: entry.link
                ? {
                      label: "Learn more",
                      href: entry.link,
                  }
                : undefined,
        }),
    )
}

/**
 * Base atom for additional banners.
 * OSS keeps this empty; EE overrides it with subscription-based banners.
 */
export const additionalBannersAtom = atom<BannerConfig[]>([])

/**
 * Computed atom that collects all active banners.
 * Combines changelog, star-repo, and any additional banners (from EE).
 */
export const activeBannersAtom = atom((get) => {
    const banners: BannerConfig[] = []

    // Changelog banners (from JSON, always active until dismissed)
    banners.push(...getChangelogBanners())

    // Star repo banner (always active until dismissed)
    banners.push(starRepoBanner)

    // Additional banners (EE injects subscription banners here)
    const additionalBanners = get(additionalBannersAtom)
    banners.push(...additionalBanners)

    return banners
})

/**
 * Computed atom for visible banners.
 * Filters out dismissed banners and sorts by priority.
 */
export const visibleBannersAtom = atom((get) => {
    const allBanners = get(activeBannersAtom)
    const dismissedIds = get(dismissedBannerIdsAtom)

    return allBanners
        .filter((banner) => !dismissedIds.includes(banner.id))
        .sort((a, b) => PRIORITY_ORDER[a.type] - PRIORITY_ORDER[b.type])
})

/**
 * Computed atom for the top visible banner (the one to display).
 * Returns null if no banners are visible.
 */
export const topVisibleBannerAtom = atom((get) => {
    const visibleBanners = get(visibleBannersAtom)
    return visibleBanners.length > 0 ? visibleBanners[0] : null
})
