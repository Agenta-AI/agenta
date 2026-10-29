import type {NextRouter} from "next/router"

import {writeLastContext} from "@/lib/context"

/** Moves to the same settings tab in another project, remembered like the nav switcher does. */
export const switchSettingsContext = (
    router: NextRouter,
    {workspaceId, projectId, tab}: {workspaceId: string; projectId: string; tab: string},
) => {
    writeLastContext({workspaceId, projectId})
    void router.push(
        `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/settings?tab=${tab}`,
    )
}
