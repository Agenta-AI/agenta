import {memo, useEffect} from "react"

import {additionalBannersAtom} from "@agenta/navigation"
import {SidebarBanners as SharedSidebarBanners} from "@agenta/navigation-ui"
import {useAtomValue, useSetAtom} from "jotai"

import {eeBannersAtom} from "./state/atoms"

/**
 * EE SidebarBanners component.
 * Injects EE-specific banners (trial, upgrade) into the shared banner system
 * and renders the shared component.
 */
const SidebarBanners = () => {
    const eeBanners = useAtomValue(eeBannersAtom)
    const setAdditionalBanners = useSetAtom(additionalBannersAtom)

    // Inject EE banners into the shared banner system
    useEffect(() => {
        setAdditionalBanners(eeBanners)
    }, [eeBanners, setAdditionalBanners])

    return <SharedSidebarBanners />
}

export default memo(SidebarBanners)
