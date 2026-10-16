import {getBrowserClient} from "@agenta/sdk/resources"

import {safeParseWithLogging} from "../shared"

import {browserLiveStatusSchema} from "./types"

/** Whether the agent of this session runs a browser right now. */
export const fetchBrowserLiveStatus = async (projectId: string, sessionId: string) => {
    const data = await getBrowserClient().fetchBrowserLiveStatus(
        {session_id: sessionId},
        {queryParams: {project_id: projectId}},
    )
    return (
        safeParseWithLogging(browserLiveStatusSchema, data, "[browser.liveStatus]") ?? {
            running: false,
        }
    )
}
