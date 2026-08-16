import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

const currentProjectId = () => getDefaultStore().get(projectIdAtom) ?? ""

/**
 * Workspace API keys.
 *
 * Prefix convention: fetchAll = GET all, create = POST, delete = DELETE.
 * `ignoreAxiosError` suppresses the global error toast for callers that render their own.
 */
export const fetchAllListApiKeys = (workspaceId: string, ignoreAxiosError = false) =>
    axios.get(
        `${getAgentaApiUrl()}/keys/?workspace_id=${workspaceId}&project_id=${currentProjectId()}`,
        {_ignoreError: ignoreAxiosError} as never,
    )

export const createApiKey = (
    workspaceId: string,
    ignoreAxiosError = false,
    projectId?: string | null,
) =>
    axios.post(
        `${getAgentaApiUrl()}/keys/?workspace_id=${workspaceId}&project_id=${
            projectId ?? currentProjectId()
        }`,
        undefined,
        {_ignoreError: ignoreAxiosError} as never,
    )

export const deleteApiKey = (prefix: string, ignoreAxiosError = false) =>
    axios.delete(`${getAgentaApiUrl()}/keys/${prefix}?project_id=${currentProjectId()}`, {
        _ignoreError: ignoreAxiosError,
    } as never)
