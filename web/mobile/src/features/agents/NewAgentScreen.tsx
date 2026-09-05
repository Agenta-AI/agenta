import {PageTitle} from "@/components/PageTitle"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {FirstRunScreen} from "../onboarding/FirstRunScreen"

/**
 * Where every "New agent" entry lands (`/agents/new`) — the same create surface a brand-new
 * project gets, under the app shell this route must provide for itself (Home provides its own
 * when it mounts the first run).
 *
 * Blank shows the template strip; `?template=<key>` arrives with the pick already made, so the
 * connect step opens in the strip's place. See [[FirstRunScreen]] for the structure.
 */
export const NewAgentScreen = ({
    workspaceId,
    projectId,
    templateKey,
}: {
    workspaceId: string
    projectId: string
    templateKey?: string
}) => {
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`

    return (
        <>
            <PageTitle title="New agent" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <FirstRunScreen
                    base={base}
                    workspaceId={workspaceId}
                    projectId={projectId}
                    templateKey={templateKey}
                />
            </AppShell>
        </>
    )
}
