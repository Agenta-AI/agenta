import {memo} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import SidebarBanner from "./SidebarBanner"
import {dismissBannerAtom, topVisibleBannerAtom} from "./state/atoms"

/**
 * SidebarBanners container component.
 * Renders the highest-priority visible banner.
 * When dismissed, the next banner in priority order will show.
 */
const SidebarBanners = () => {
    const topBanner = useAtomValue(topVisibleBannerAtom)
    const dismissBanner = useSetAtom(dismissBannerAtom)

    if (!topBanner) {
        return null
    }

    const handleDismiss = () => {
        if (topBanner.dismissible) {
            dismissBanner(topBanner.id)
        }
    }

    // px-2 matches the nav items' 8px inline margin so the card shares their edges.
    return (
        <div className="w-full shrink-0 px-[19px]">
            <SidebarBanner
                banner={topBanner}
                onDismiss={topBanner.dismissible ? handleDismiss : undefined}
            />
        </div>
    )
}

export default memo(SidebarBanners)
