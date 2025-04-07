import {getAppValues} from "@/oss/contexts/app.context"
import {getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {Environment} from "@/oss/lib/Types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchEnvironments = async (appId: string): Promise<Environment[]> => {
    try {
        const {projectId} = getCurrentProject()

        const response = await axios.get(
            `${getAgentaApiUrl()}/api/apps/${appId}/environments?project_id=${projectId}`,
        )
        return response.data
    } catch (error) {
        throw new Error("Failed to fetch environments")
    }
}

export const createPublishVariant = async (payload: {
    variant_id: string
    revision_id?: string
    environment_name: string
    note?: string
}) => {
    const {projectId} = getCurrentProject()
    const {note, revision_id, ..._payload} = payload
    await axios.post(`${getAgentaApiUrl()}/api/environments/deploy?project_id=${projectId}`, {
        ..._payload,
        commit_message: note,
    })
}

export const createPublishRevision = async (payload: {
    revision_id?: string
    environment_ref: string
    application_id?: string
    revision_number?: number
    note?: string
}) => {
    const {projectId} = getCurrentProject()
    const {currentApp} = getAppValues()

    await axios.post(`${getAgentaApiUrl()}/api/variants/configs/deploy?project_id=${projectId}`, {
        application_ref: {
            id: payload.application_id || currentApp?.app_id,
            version: null,
            slug: null,
        },
        variant_ref: {
            id: payload.revision_id,
            version: payload.revision_number || null,
            slug: null,
            commit_message: payload.note || null,
        },
        environment_ref: {
            slug: payload.environment_ref,
            version: null,
            id: null,
        },
    })
}
