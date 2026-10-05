import {writeLastContext} from "@/lib/context"

/** The same settings tab in another project, remembered as the last context like the switcher does. */
export const settingsUrlFor = ({
    workspaceId,
    projectId,
    tab,
}: {
    workspaceId: string
    projectId: string
    tab: string
}): string => {
    writeLastContext({workspaceId, projectId})
    return `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/settings?tab=${tab}`
}
