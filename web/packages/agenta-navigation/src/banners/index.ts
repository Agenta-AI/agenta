/**
 * The sidebar banner MODEL: the card configs, their priority/dismissal rules, and the
 * `additionalBannersAtom` seam EE fills with its subscription banners. Renderer-free, so
 * every shell over `@agenta/navigation` (desktop rail, mobile rail + drawer) shares one
 * banner queue and one dismissed-ids bucket.
 */
export type {BannerAction, BannerConfig, BannerType} from "./types"
export {
    activeBannersAtom,
    additionalBannersAtom,
    dismissBannerAtom,
    dismissedBannerIdsAtom,
    MAX_DISMISSIBLE_SIDEBAR_BANNERS,
    PRIORITY_ORDER,
    topVisibleBannerAtom,
    visibleBannersAtom,
} from "./state"
