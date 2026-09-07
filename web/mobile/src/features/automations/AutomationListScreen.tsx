import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

/**
 * The automations list — where the nav's Automations entry lands.
 *
 * The shell only, for now: identity row and frame. The table, its search and its row verbs land
 * on top of `useAutomations` in W2.
 */
export const AutomationListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
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
                                {/* Same title ramp the other browse screens use: the body rung on
                                    a phone, the desktop page-title rung from `sm`. */}
                                <h1 className="text-colorText m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Automations
                                </h1>
                            </div>
                        </div>
                    }
                >
                    {null}
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
