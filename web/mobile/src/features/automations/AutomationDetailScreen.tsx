import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

/**
 * One automation — its identity, its schedule or event, and its recent runs.
 *
 * The shell only, for now: the body reads `useAutomation` in W3, which is also where the
 * kind reaches this screen (the list row knows it; a cold load resolves it there).
 */
export const AutomationDetailScreen = ({
    workspaceId,
    projectId,
    automationId,
}: {
    workspaceId: string
    projectId: string
    automationId: string
}) => {
    useBindProjectContext(projectId)

    return (
        <>
            <PageTitle title="Automations" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="flex shrink-0 flex-col gap-3 px-6 pb-3 pt-2 lg:px-16 lg:pt-14">
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="text-colorText m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Automations
                                </h1>
                            </div>
                        </div>
                    }
                >
                    {/* W3 renders the automation here; the id is already resolved so the route
                        shell stays thin. */}
                    <span className="sr-only">{automationId}</span>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
