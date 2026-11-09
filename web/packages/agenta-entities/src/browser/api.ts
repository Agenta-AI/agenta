import {getBrowserClient} from "@agenta/sdk/resources"

import {safeParseWithLogging} from "../shared"

import {browserLiveStatusSchema, type BrowserLiveStatus} from "./types"

const NOT_RUNNING: BrowserLiveStatus = {running: false, waitReason: "", url: ""}

/** Whether the agent of this session runs a browser right now, and what it shows. */
export const fetchBrowserLiveStatus = async (
    projectId: string,
    sessionId: string,
): Promise<BrowserLiveStatus> => {
    const data = await getBrowserClient().fetchBrowserLiveStatus(
        {session_id: sessionId},
        {queryParams: {project_id: projectId}},
    )
    return (
        safeParseWithLogging(browserLiveStatusSchema, data, "[browser.liveStatus]") ?? NOT_RUNNING
    )
}
