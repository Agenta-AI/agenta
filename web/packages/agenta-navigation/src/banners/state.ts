import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {BannerConfig, BannerType} from "./types"

/**
 * Priority order for banner types.
 * Lower number = higher priority (shown first).
 *
 * Order: star-repo → upgrade → trial
 * Community first; billing-related banners only after engaging with the product.
 */
export const PRIORITY_ORDER: Record<BannerType, number> = {
    "star-repo": 0, // Highest priority - show first for new users
    upgrade: 1,
    trial: 2, // Lowest priority - show after other banners are dismissed
}

/**
 * Maximum number of dismissible sidebar banners a user should have to clear.
 * Apply this before dismissal filtering so older entries do not backfill the
 * sidebar after each close.
 */
export const MAX_DISMISSIBLE_SIDEBAR_BANNERS = 2

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
 * Base atom for additional banners.
 * OSS keeps this empty; EE overrides it with subscription-based banners.
 */
export const additionalBannersAtom = atom<BannerConfig[]>([])

/**
 * Computed atom that collects all active banners.
 * Combines star-repo and any additional banners (from EE). A release is NOT a banner:
 * releases read as the "What's new?" list in the help menu.
 */
export const activeBannersAtom = atom((get) => {
    const banners: BannerConfig[] = []

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
    const sortedBanners = [...allBanners].sort(
        (a, b) => PRIORITY_ORDER[a.type] - PRIORITY_ORDER[b.type],
    )

    // Trial banners are time-bound and must stay visible for the whole trial, so they are
    // exempt from the cap even though they are dismissible.
    const countsTowardCap = (banner: BannerConfig) => banner.dismissible && banner.type !== "trial"

    const cappedDismissibleBanners = sortedBanners
        .filter(countsTowardCap)
        .slice(0, MAX_DISMISSIBLE_SIDEBAR_BANNERS)

    const uncappedBanners = sortedBanners.filter((banner) => !countsTowardCap(banner))

    return [...cappedDismissibleBanners, ...uncappedBanners]
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
