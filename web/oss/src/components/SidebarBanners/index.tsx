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

    // box-border is explicit because preflight is off; the app only gets border-box from
    // antd's `.ant-layout *` reset, which does not reach portalled trees.
    return (
        <div className="box-border w-full shrink-0 px-[19px]">
            <SidebarBanner
                banner={topBanner}
                onDismiss={topBanner.dismissible ? handleDismiss : undefined}
            />
        </div>
    )
}

export default memo(SidebarBanners)
