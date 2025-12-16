import {memo, useEffect} from "react"

import {useAtomValue, useSetAtom} from "jotai"

// Import directly from OSS using relative path to avoid EE path alias resolution
import OssSidebarBanners from "../../../../oss/src/components/SidebarBanners"
import {additionalBannersAtom} from "../../../../oss/src/components/SidebarBanners/state/atoms"

import {eeBannersAtom} from "./state/atoms"

/**
 * EE SidebarBanners component.
 * Injects EE-specific banners (trial, upgrade) into the OSS banner system
 * and renders the OSS component.
 */
const SidebarBanners = () => {
    const eeBanners = useAtomValue(eeBannersAtom)
    const setAdditionalBanners = useSetAtom(additionalBannersAtom)

    // Inject EE banners into the OSS banner system
    useEffect(() => {
        setAdditionalBanners(eeBanners)
    }, [eeBanners, setAdditionalBanners])

    return <OssSidebarBanners />
}

export default memo(SidebarBanners)
