import {matchingTracesQueryAtomFamily} from "@agenta/entities/query"
import type {TraceSpanNode} from "@agenta/entities/trace"
import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {attachAnnotationsToTraces} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import type {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {queryAllAnnotations} from "@/oss/services/annotations/api"
import {getOrgValues} from "@/oss/state/org"

interface TreeNode {
    invocationIds?: {trace_id?: string; span_id?: string} | null
    aggregatedEvaluatorMetrics?: Record<string, unknown> | null
    children?: TreeNode[] | null
}

interface QueryTracePreviewParams {
    projectId?: string | null
    filtering?: unknown
    limit: number
}

const collectInvocationLinks = (nodes: TreeNode[]) => {
    const links: {trace_id: string; span_id: string}[] = []
    const seen = new Set<string>()
    const visit = (node?: TreeNode) => {
        if (!node) return
        const ids = node.invocationIds
        if (ids?.trace_id && ids?.span_id) {
            const key = `${ids.trace_id}:${ids.span_id}`
            if (!seen.has(key)) {
                seen.add(key)
                links.push({trace_id: ids.trace_id, span_id: ids.span_id})
            }
        }
        node.children?.forEach(visit)
    }
    nodes.forEach(visit)
    return links
}

export const collectEvaluatorSlugs = (nodes: unknown[]) => {
    const slugs = new Set<string>()
    const visit = (node?: TreeNode) => {
        if (!node) return
        Object.keys(node.aggregatedEvaluatorMetrics ?? {}).forEach((slug) => slugs.add(slug))
        node.children?.forEach(visit)
    }
    for (const node of nodes as TreeNode[]) visit(node)
    return Array.from(slugs)
}

const queryTracePreviewAnnotationsAtomFamily = atomFamily(
    (params: QueryTracePreviewParams) =>
        atomWithQuery<AnnotationDto[]>((get) => {
            const tracesQuery = get(matchingTracesQueryAtomFamily(params))
            const links = collectInvocationLinks((tracesQuery.data ?? []) as unknown as TreeNode[])
            return {
                queryKey: ["query-trace-preview", "annotations", params.projectId, links],
                queryFn: async () => {
                    if (!links.length) return []
                    const {selectedOrg} = getOrgValues()
                    const members = selectedOrg?.default_workspace?.members || []
                    const response = await queryAllAnnotations({annotation: {links}})
                    return (
                        response.annotations?.map((annotation) =>
                            transformApiData<AnnotationDto>({data: annotation, members}),
                        ) ?? []
                    )
                },
                enabled: links.length > 0,
                staleTime: 60_000,
                refetchOnWindowFocus: false,
            }
        }),
    deepEqual,
)

export const queryTracePreviewAtomFamily = atomFamily(
    (params: QueryTracePreviewParams) =>
        atom((get) => {
            const tracesQuery = get(matchingTracesQueryAtomFamily(params))
            const annotationsQuery = get(queryTracePreviewAnnotationsAtomFamily(params))
            const traces = tracesQuery.data ?? []
            const annotations = annotationsQuery.data ?? []
            const hasAnnotationLinks =
                collectInvocationLinks(traces as unknown as TreeNode[]).length > 0

            return {
                traces: attachAnnotationsToTraces(
                    traces as never[],
                    annotations,
                ) as unknown as TraceSpanNode[],
                isPending:
                    tracesQuery.isPending || (hasAnnotationLinks && annotationsQuery.isPending),
                isError: tracesQuery.isError || annotationsQuery.isError,
            }
        }),
    deepEqual,
)
