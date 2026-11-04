import {executionHeadersAtom} from "@agenta/playground/execution-headers"
import {getDefaultStore} from "jotai"

import {getAccessToken} from "@/lib/auth"

/** Bearer token for playground run requests, or nothing when there is no session. */
const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const token = await getAccessToken()
    return token ? {Authorization: `Bearer ${token}`} : {}
}

/**
 * Registers the auth-header provider the playground's run requests use, in the store the app
 * provides. The app shell calls it at module scope, so the provider is in place before any page
 * renders and before any run can start.
 *
 * It imports only the header atom, not `executionItemController`: the shell loads on every page,
 * and the controller pulls the whole execution runner in with it.
 *
 * `buildAgentRequest` used to append `project_id` to the invoke URL only alongside an
 * Authorization header, so a run with no header ran against the caller's DEFAULT project and
 * reported the agent's own connection missing. It now always sends `project_id`; the header
 * stays for the requests that read the Bearer token itself. A cookie session with no readable
 * access token sends none, and still runs in the right project.
 */
export const registerExecutionHeaders = () => {
    // A function value must be wrapped: jotai reads a bare function as an updater.
    getDefaultStore().set(executionHeadersAtom, () => getAuthHeaders)
}
