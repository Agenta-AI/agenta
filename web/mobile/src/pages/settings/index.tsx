import {useState} from "react"

import {ContextResolver} from "@/features/context/ContextResolver"
import {takeLicenseLinkKey, type LastContext} from "@/lib/context"

// Thin shell: `/m/settings?tab=...` (the license activation link) opens Settings in the
// resolved project, keeping the query.
const toProjectSettings = ({workspaceId, projectId}: LastContext): string =>
    `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/settings${window.location.search}`

export default function SettingsRedirect() {
    useState(takeLicenseLinkKey)
    return <ContextResolver forwardTo={toProjectSettings} />
}
