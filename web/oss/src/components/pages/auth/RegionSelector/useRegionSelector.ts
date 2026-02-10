import {useCallback, useEffect, useState} from "react"

import {
    buildSwitchUrl,
    getCloudRegion,
    getPreferredRegion,
    isCloudAliasHost,
    RegionId,
    setPreferredRegion,
} from "@/oss/lib/helpers/region"

const REDIRECT_KEY_PREFIX = "region-redirect-"

export const useRegionSelector = () => {
    const currentRegion = getCloudRegion()
    const [isSwitching, setIsSwitching] = useState(false)
    const [pendingRegion, setPendingRegion] = useState<RegionId | null>(null)

    const isAuthCallback =
        typeof window !== "undefined" && window.location.pathname.startsWith("/auth/callback")

    useEffect(() => {
        if (!currentRegion || typeof window === "undefined") return

        // On a region host (not alias), clear redirect guards and persist preference.
        if (!isCloudAliasHost()) {
            try {
                sessionStorage.removeItem(`${REDIRECT_KEY_PREFIX}eu`)
                sessionStorage.removeItem(`${REDIRECT_KEY_PREFIX}us`)
            } catch {
                // sessionStorage may be unavailable (private browsing, etc.)
            }

            if (getPreferredRegion() !== currentRegion) {
                setPreferredRegion(currentRegion)
            }
            return
        }

        // On the alias host, auto-redirect to the preferred region.
        if (isAuthCallback) return

        const preferredRegion = getPreferredRegion()
        if (!preferredRegion || preferredRegion === currentRegion) return

        // Guard against redirect loops: if we already tried this redirect in
        // this session and ended up back on the alias, do not try again.
        try {
            const key = `${REDIRECT_KEY_PREFIX}${preferredRegion}`
            if (sessionStorage.getItem(key)) {
                sessionStorage.removeItem(key)
                return
            }
            sessionStorage.setItem(key, "1")
        } catch {
            // If sessionStorage is unavailable, skip the guard and redirect anyway.
        }

        const targetUrl = buildSwitchUrl(preferredRegion)
        if (targetUrl) {
            window.location.replace(targetUrl)
        }
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
