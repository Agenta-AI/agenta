/**
 * DTO-shaped annotation queries.
 *
 * Returns the raw `simple/traces` payload rather than the zod-validated
 * `Annotation` entity — callers here aggregate annotations across a trace list
 * and must not have non-conforming rows dropped. Use `queryAnnotations` from
 * `../api` when you want the validated entity.
 */
import {axios, getAgentaApiUrl} from "@agenta/shared/api"

import type {AnnotationDto, AnnotationsResponseDto} from "./types"

// Map annotation-specific query keys to simple-traces equivalents
const mapAnnotationQueryToTrace = (queries?: Record<string, unknown>): Record<string, unknown> => {
    if (!queries || !Object.keys(queries).length) return {}
    const {annotation_links, annotation, ...rest} = queries
    const body: Record<string, unknown> = {...rest}
    if (annotation_links) body.links = annotation_links
    if (annotation) body.trace = annotation
    return body
}

// Map simple-traces response back to annotation-compatible shape
const mapTraceResponseToAnnotation = (data: {
    count?: number
    trace?: AnnotationDto | null
    traces?: AnnotationDto[] | null
}): AnnotationsResponseDto => ({
    ...data,
    count: data?.count ?? 0,
    annotation: (data?.trace ?? null) as AnnotationDto,
    annotations: data?.traces ?? [],
})

export const queryAllAnnotations = async ({
    projectId,
    queries,
}: {
    projectId?: string
    queries?: Record<string, unknown>
}): Promise<AnnotationsResponseDto> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/simple/traces/query`,
        mapAnnotationQueryToTrace(queries),
        {params: projectId ? {project_id: projectId} : undefined},
    )
    return mapTraceResponseToAnnotation(response.data ?? {})
}
