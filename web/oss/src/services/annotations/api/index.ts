import axios from "@/oss/lib/api/assets/axiosConfig"
import {fetchJson, getBaseUrl, ensureProjectId} from "@/oss/lib/api/assets/fetchClient"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {
    AnnotationDto,
    AnnotationEditPayloadDto,
    AnnotationsResponse,
} from "@/oss/lib/hooks/useAnnotations/types"
import {getProjectValues} from "@/oss/state/project"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const queryAllAnnotations = async (
    queries?: Record<string, any>,
): Promise<AnnotationsResponse> => {
    const projectId = ensureProjectId()
    const base = getBaseUrl()
    const url = new URL(`${base}/preview/annotations/query`)
    if (projectId) url.searchParams.set("project_id", projectId)
    const body = queries && Object.keys(queries).length > 0 ? queries : {}
    return fetchJson(url, {method: "POST", body: JSON.stringify(body)})
}

export const createAnnotation = async (annotationPayload: AnnotationDto) => {
    const {projectId} = getProjectValues()

    return await axios.post(
        `${getAgentaApiUrl()}/preview/annotations/?project_id=${projectId}`,
        annotationPayload,
    )
}

export const updateAnnotation = async ({
    payload,
    traceId,
    spanId,
}: {
    payload: AnnotationEditPayloadDto
    traceId: string
    spanId: string
}) => {
    const {projectId} = getProjectValues()

    return await axios.patch(
        `${getAgentaApiUrl()}/preview/annotations/${traceId}/${spanId}?project_id=${projectId}`,
        payload,
    )
}

export const fetchAnnotation = async ({
    traceId,
    spanId,
    signal,
}: {
    traceId?: string
    spanId?: string
    signal?: AbortSignal
}): Promise<AnnotationsResponse | null> => {
    const {projectId} = getProjectValues()

    return new Promise((resolve) => {
        if (!traceId || !spanId) {
            resolve(null)
        } else {
            axios
                .get(
                    `${getAgentaApiUrl()}/preview/annotations/${traceId}/${spanId}?project_id=${projectId}`,
                    {signal},
                )
                .then((response) => {
                    resolve(response.data)
                })
        }
    })
}

export const deleteAnnotation = async ({traceId, spanId}: {traceId: string; spanId: string}) => {
    const {projectId} = getProjectValues()

    return await axios.delete(
        `${getAgentaApiUrl()}/preview/annotations/${traceId}/${spanId}?project_id=${projectId}`,
    )
}
