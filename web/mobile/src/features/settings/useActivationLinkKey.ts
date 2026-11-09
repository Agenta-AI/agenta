import {useCallback, useState} from "react"

import {forgetLicenseKey, peekLicenseKey} from "@/lib/context"

/**
 * The key an activation link carried in its `#key=` fragment. `/m/settings` moved it into
 * session storage before anything could send the page address. It stays there until the key is
 * added, the reader dismisses it, or the page finds the reader cannot add it, so a sign-in that
 * interrupts this page does not lose it.
 */
export const useActivationLinkKey = (): [string | null, () => void] => {
    const [key, setKey] = useState<string | null>(() =>
        typeof window === "undefined" ? null : peekLicenseKey() || null,
    )
    const dismiss = useCallback(() => {
        forgetLicenseKey()
        setKey(null)
    }, [])
    return [key, dismiss]
}
