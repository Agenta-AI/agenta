import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {BannerConfig, BannerType} from "./types"

/**
 * Priority order for banner types.
 * Lower number = higher priority (shown first).
 *
 * Order: upgrade → trial
 */
export const PRIORITY_ORDER: Record<BannerType, number> = {
    upgrade: 0,
    trial: 1, // Lowest priority - show after other banners are dismissed
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
 * Base atom for additional banners.
 * OSS keeps this empty; EE overrides it with subscription-based banners.
 */
export const additionalBannersAtom = atom<BannerConfig[]>([])

/**
 * Every banner the rail could show. All of them come through `additionalBannersAtom`: OSS has
 * none, EE injects its subscription banners. A release is NOT a banner (it reads as the "What's
 * new?" list in the help menu), and neither is the star-repo ask, which lives in the same menu's
 * GitHub link.
 */
export const activeBannersAtom = atom((get) => get(additionalBannersAtom))

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
