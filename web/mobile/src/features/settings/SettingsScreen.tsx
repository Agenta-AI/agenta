import {ContentRail} from "@/components/ContentRail"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useCurrentProject} from "../context/useCurrentProject"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

/**
 * A placeholder, deliberately: the nav entry exists so the rail matches the desktop's shape,
 * and this screen says plainly that the settings surfaces are not here yet rather than
 * pretending with controls that do nothing.
 */
export const SettingsScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const project = useCurrentProject(workspaceId, projectId)

    return (
        <>
            <PageTitle parts={["Settings", project?.project_name]} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="border-border shrink-0 border-b px-4 pb-3 pt-2">
                            <ContentRail className="flex items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 text-sm font-semibold">Settings</h1>
                            </ContentRail>
                        </div>
                    }
                >
                    <ContentRail className="pb-6">
                        <p className="text-muted-foreground px-4 py-6 text-xs">
                            Settings are not available here yet. Manage them from the desktop app in
                            the meantime.
                        </p>
                    </ContentRail>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
