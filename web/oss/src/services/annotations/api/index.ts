import {queryAllAnnotations as queryAllAnnotationsDto} from "@agenta/entities/annotation/dto"
import type {
    AnnotationEditPayloadDto,
    AnnotationsResponseDto,
} from "@agenta/entities/annotation/dto"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {ensureProjectId} from "@/oss/lib/api/assets/fetchClient"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

// Moved to @agenta/entities/annotation/dto; this keeps the implicit-project-id
// signature the OSS call sites use. The CRUD helpers below stay in OSS — the
// package's annotation module already owns those five export names for its
// zod-validated entity API.
export const queryAllAnnotations = async (
    queries?: Record<string, any>,
): Promise<AnnotationsResponseDto> =>
    queryAllAnnotationsDto({projectId: ensureProjectId(), queries})

// Map simple-traces response back to annotation-compatible shape
const mapTraceResponseToAnnotation = (data: any): AnnotationsResponseDto => ({
    ...data,
    annotation: data.trace ?? null,
    annotations: data.traces ?? [],
})

export const createAnnotation = async (annotationPayload: any) => {
    const {projectId} = getProjectValues()
    const tracePayload = (annotationPayload as any)?.annotation ?? annotationPayload
    return await axios.post(`${getAgentaApiUrl()}/simple/traces/?project_id=${projectId}`, {
        trace: tracePayload,
    })
}

export const updateAnnotation = async ({
    payload,
    traceId,
    spanId: _spanId,
}: {
    payload: AnnotationEditPayloadDto
    traceId: string
    spanId: string
}) => {
    const {projectId} = getProjectValues()
    const tracePayload = (payload as any)?.annotation ?? payload
    return await axios.patch(
        `${getAgentaApiUrl()}/simple/traces/${traceId}?project_id=${projectId}`,
        {trace: tracePayload},
    )
}

export const fetchAnnotation = async ({
    traceId,
    spanId: _spanId,
    signal,
}: {
    traceId?: string
    spanId?: string
    signal?: AbortSignal
}): Promise<AnnotationsResponseDto | null> => {
    const {projectId} = getProjectValues()

    return new Promise((resolve) => {
        if (!traceId) {
            resolve(null)
        } else {
            axios
                .get(`${getAgentaApiUrl()}/simple/traces/${traceId}?project_id=${projectId}`, {
                    signal,
                })
                .then((response) => {
                    resolve(mapTraceResponseToAnnotation(response.data))
                })
        }
    })
}

export const deleteAnnotation = async ({
    traceId,
    spanId: _spanId,
}: {
    traceId: string
    spanId: string
}) => {
    const {projectId} = getProjectValues()

    return await axios.delete(
        `${getAgentaApiUrl()}/simple/traces/${traceId}?project_id=${projectId}`,
    )
}
