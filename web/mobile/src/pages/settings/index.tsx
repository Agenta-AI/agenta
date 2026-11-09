import {ContextResolver} from "@/features/context/ContextResolver"
import type {LastContext} from "@/lib/context"

// Thin shell: `/m/settings?tab=...` (the license activation link) opens Settings in the
// resolved project, keeping the query and the `#key=` fragment.
const toProjectSettings = ({workspaceId, projectId}: LastContext): string =>
    `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/settings${window.location.search}${window.location.hash}`

export default function SettingsRedirect() {
    return <ContextResolver forwardTo={toProjectSettings} />
}
