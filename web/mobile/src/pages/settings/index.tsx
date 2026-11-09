import {useState} from "react"

import {ContextResolver} from "@/features/context/ContextResolver"
import {rememberLicenseKey, type LastContext} from "@/lib/context"

// Thin shell: `/m/settings?tab=...` (the license activation link) opens Settings in the
// resolved project, keeping the query.
const toProjectSettings = ({workspaceId, projectId}: LastContext): string =>
    `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/settings${window.location.search}`

/**
 * Move the `#key=` of an activation link into session storage and out of the address bar,
 * during the first render: before analytics loads and sends the page address, and before a
 * sign-in redirect drops it.
 */
const takeLinkKey = () => {
    if (typeof window === "undefined") return
    const key = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("key")?.trim()
    if (!key) return
    rememberLicenseKey(key)
    const {pathname, search} = window.location
    window.history.replaceState(window.history.state, "", `${pathname}${search}`)
}

export default function SettingsRedirect() {
    useState(takeLinkKey)
    return <ContextResolver forwardTo={toProjectSettings} />
}
