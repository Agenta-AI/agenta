import {memo, useEffect} from "react"

import OssSidebarBanners from "@agenta/oss/src/components/SidebarBanners"
import {additionalBannersAtom} from "@agenta/oss/src/components/SidebarBanners/state/atoms"
import {useAtomValue, useSetAtom} from "jotai"

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
