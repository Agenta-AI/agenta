import axios from "@/oss/lib/api/assets/axiosConfig"
import {fetchJson, getBaseUrl, ensureProjectId} from "@/oss/lib/api/assets/fetchClient"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {AnnotationEditPayloadDto, AnnotationsResponse} from "@/oss/lib/hooks/useAnnotations/types"
import {getProjectValues} from "@/oss/state/project"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

// Map annotation-specific query keys to simple-traces equivalents
const mapAnnotationQueryToTrace = (queries?: Record<string, any>): Record<string, any> => {
    if (!queries || !Object.keys(queries).length) return {}
    const {annotation_links, annotation, ...rest} = queries as any
    const body: Record<string, any> = {...rest}
    if (annotation_links) body.links = annotation_links
    if (annotation) body.trace = annotation
    return body
}

// Map simple-traces response back to annotation-compatible shape
const mapTraceResponseToAnnotation = (data: any): AnnotationsResponse => ({
    ...data,
    annotation: data.trace ?? null,
    annotations: data.traces ?? [],
})

export const queryAllAnnotations = async (
    queries?: Record<string, any>,
): Promise<AnnotationsResponse> => {
    const projectId = ensureProjectId()
    const base = getBaseUrl()
    const url = new URL(`${base}/simple/traces/query`)
    if (projectId) url.searchParams.set("project_id", projectId)
    const body = mapAnnotationQueryToTrace(queries)
    const data = await fetchJson(url, {method: "POST", body: JSON.stringify(body)})
    return mapTraceResponseToAnnotation(data)
}

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
}): Promise<AnnotationsResponse | null> => {
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
