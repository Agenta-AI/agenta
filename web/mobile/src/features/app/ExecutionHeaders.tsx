import {useEffect} from "react"

import {executionItemController} from "@agenta/playground"
import {useSetAtom} from "jotai"

import {getAccessToken} from "@/lib/auth"

/** Bearer token for playground run requests, or nothing when there is no session. */
const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const token = await getAccessToken()
    return token ? {Authorization: `Bearer ${token}`} : {}
}

/**
 * Registers the auth-header provider the playground's run requests use.
 *
 * `buildAgentRequest` used to append `project_id` to the invoke URL only alongside an
 * Authorization header, so a run with no header ran against the caller's DEFAULT project and
 * reported the agent's own connection missing. It now always sends `project_id`; the header
 * stays for the requests that read the Bearer token itself. A cookie session with no readable
 * access token sends none, and still runs in the right project.
 */
export const ExecutionHeaders = () => {
    const setHeaders = useSetAtom(executionItemController.actions.setExecutionHeaders)
    useEffect(() => {
        setHeaders(() => getAuthHeaders)
    }, [setHeaders])
    return null
}
