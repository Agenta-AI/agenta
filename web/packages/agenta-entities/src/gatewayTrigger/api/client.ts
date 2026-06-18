import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

/**
 * HTTP client for the `/triggers/*` API.
 *
 * The triggers catalog isn't in the Fern client yet (WP1 hasn't been
 * regenerated into `@agentaai/api-client`), so we use the shared axios
 * instance. Once the client gains a `triggers` resource this module collapses
 * onto `getAgentaSdkClient().triggers` like `gatewayTool/api/client.ts`.
 */
export const triggersBaseUrl = () => `${getAgentaApiUrl()}/triggers`

/**
 * Scope a request to the current project. The shared axios interceptor does
 * not inject `project_id`, so we mirror `gatewayTool`'s `projectScopedRequest`
 * and read it from the shared atom.
 */
export function projectScopedParams(extra?: Record<string, unknown>) {
    const projectId = getDefaultStore().get(projectIdAtom)
    return {
        params: {
            ...(projectId ? {project_id: projectId} : {}),
            ...(extra ?? {}),
        },
    }
}

export {axios}
