import {useCallback, useEffect, useMemo, useState} from "react"

import {
    buildSwitchUrl,
    getCloudRegion,
    getPreferredRegion,
    isCloudAliasHost,
    RegionId,
    setPreferredRegion,
} from "@/oss/lib/helpers/region"

export const useRegionSelector = () => {
    const currentRegion = getCloudRegion()
    const [isSwitching, setIsSwitching] = useState(false)
    const [pendingRegion, setPendingRegion] = useState<RegionId | null>(null)
    const isAuthCallback = useMemo(() => {
        if (typeof window === "undefined") return false
        return window.location.pathname.startsWith("/auth/callback")
    }, [])

    useEffect(() => {
        if (!currentRegion || typeof window === "undefined") return

        const preferredRegion = getPreferredRegion()
        if (
            isCloudAliasHost() &&
            preferredRegion &&
            preferredRegion !== currentRegion &&
            !isAuthCallback
        ) {
            const targetUrl = buildSwitchUrl(preferredRegion)
            if (targetUrl) {
                window.location.replace(targetUrl)
                return
            }
        }

        setPreferredRegion(currentRegion)
    }, [currentRegion, isAuthCallback])

    const switchToRegion = useCallback(
        (target: RegionId) => {
            if (!currentRegion || target === currentRegion || isSwitching) return
            const targetUrl = buildSwitchUrl(target)
            if (!targetUrl) return
            setPendingRegion(target)
            setIsSwitching(true)
            setPreferredRegion(target)
            window.location.assign(targetUrl)
        },
        [currentRegion, isSwitching],
    )

    return {
        currentRegion,
        isSwitching,
        pendingRegion,
        switchToRegion,
    }
}
