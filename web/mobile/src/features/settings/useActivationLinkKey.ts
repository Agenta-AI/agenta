import {useEffect, useState} from "react"

import {forgetLicenseKey, peekLicenseKey} from "@/lib/context"

/**
 * The key an activation link carried in its `#key=` fragment. `/m/settings` moved it into
 * session storage before anything could send the page address; it is read once here and then
 * forgotten, so it applies to this visit only.
 */
export const useActivationLinkKey = (): [string | null, () => void] => {
    const [key, setKey] = useState<string | null>(() =>
        typeof window === "undefined" ? null : peekLicenseKey() || null,
    )
    useEffect(() => {
        forgetLicenseKey()
    }, [])
    return [key, () => setKey(null)]
}
