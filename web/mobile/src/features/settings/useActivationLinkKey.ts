import {useState} from "react"

/**
 * The key an activation link carries in its `#key=` fragment, read once. The fragment never
 * reaches a server; it is removed from the address bar at once so the key is not left in the
 * browser history.
 */
export const useActivationLinkKey = (): [string | null, () => void] => {
    const [key, setKey] = useState<string | null>(() => {
        if (typeof window === "undefined") return null
        const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""))
        const value = fragment.get("key")?.trim() || null
        if (value) {
            const {pathname, search} = window.location
            window.history.replaceState(window.history.state, "", `${pathname}${search}`)
        }
        return value
    })
    return [key, () => setKey(null)]
}
