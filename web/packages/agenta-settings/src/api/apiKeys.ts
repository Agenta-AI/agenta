import {getKeysClient} from "@agenta/sdk/resources"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

const currentProjectId = () => getDefaultStore().get(projectIdAtom) ?? ""

export interface ApiKeyRecord {
    prefix: string
    created_at?: string
    expiration_date?: string
    [extra: string]: unknown
}

/**
 * Workspace API keys, over the Fern keys resource.
 *
 * The generated methods take no scope arguments — the spec does not declare `workspace_id` or
 * `project_id` on these routes even though the backend reads them — so both ride along as
 * `queryParams`. Dropping them would silently list and mint keys for the wrong workspace.
 */
export const fetchAllListApiKeys = async (workspaceId: string): Promise<ApiKeyRecord[]> => {
    const data = await getKeysClient().listApiKeys({
        queryParams: {workspace_id: workspaceId, project_id: currentProjectId()},
    })
    return Array.isArray(data) ? (data as ApiKeyRecord[]) : []
}

/** Returns the new key itself — the only time its full value is ever available. */
export const createApiKey = async (
    workspaceId: string,
    projectId?: string | null,
): Promise<string> => {
    const data = await getKeysClient().createApiKey({
        queryParams: {workspace_id: workspaceId, project_id: projectId ?? currentProjectId()},
    })
    return typeof data === "string" ? data : ""
}

export const deleteApiKey = async (prefix: string): Promise<void> => {
    await getKeysClient().deleteApiKey(
        {key_prefix: prefix},
        {queryParams: {project_id: currentProjectId()}},
    )
}
