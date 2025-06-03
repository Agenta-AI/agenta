import {getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {
    AnnotationDto,
    AnnotationEditPayloadDto,
    AnnotationsResponse,
} from "@/oss/lib/hooks/useAnnotations/types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const queryAllAnnotations = async (queries?: {
    annotation: Record<string, any>
}): Promise<AnnotationsResponse> => {
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/api/preview/annotations/query?project_id=${projectId}`,
        Object.keys(queries?.annotation || {}).length > 0 ? queries : {},
    )

    return response.data
}

export const createAnnotation = async (annotationPayload: AnnotationDto) => {
    const {projectId} = getCurrentProject()

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
    const {projectId} = getCurrentProject()

    return await axios.patch(
        `${getAgentaApiUrl()}/api/preview/annotations/${traceId}/${spanId}?project_id=${projectId}`,
        payload,
    )
}

export const fetchAnnotation = async ({traceId, spanId}: {traceId: string; spanId: string}) => {
    const {projectId} = getCurrentProject()

    const response = await axios.get(
        `${getAgentaApiUrl()}/preview/annotations/${traceId}/${spanId}?project_id=${projectId}`,
    )

    return response.data
}

export const deleteAnnotation = async ({traceId, spanId}: {traceId: string; spanId: string}) => {
    const {projectId} = getCurrentProject()

    return await axios.delete(
        `${getAgentaApiUrl()}/preview/annotations/${traceId}/${spanId}?project_id=${projectId}`,
    )
}
