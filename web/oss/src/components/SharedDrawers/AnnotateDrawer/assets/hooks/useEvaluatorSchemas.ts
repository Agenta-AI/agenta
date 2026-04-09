import {useMemo} from "react"

import {resolveOutputSchema} from "@agenta/entities/workflow"
import {getAgentaApiUrl} from "@agenta/shared/api"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {EvaluatorDto} from "@/oss/services/evaluations/api/evaluatorTypes"
import {getProjectValues} from "@/oss/state/project"

/**
 * Per-evaluator query that fetches full evaluator data via the simple evaluators API.
 * This endpoint resolves to the latest revision internally and includes `data` with schemas.
 */
const simpleEvaluatorQueryFamily = atomFamily((evaluatorId: string) =>
    atomWithQuery(() => ({
        queryKey: ["simple-evaluator", evaluatorId],
        queryFn: async () => {
            const {projectId} = getProjectValues()
            if (!projectId || !evaluatorId) return null
            const res = await fetch(
                `${getAgentaApiUrl()}/simple/evaluators/${evaluatorId}?project_id=${projectId}`,
            )
            if (!res.ok) return null
            const json = await res.json()
            return json?.evaluator ?? null
        },
        enabled: !!evaluatorId,
        staleTime: 60_000,
    })),
)

/**
 * Resolves full evaluator data from the simple evaluators API for a list of
 * thin evaluator refs (which only carry id/name/slug but no `data`).
 *
 * The simple evaluator endpoint resolves the latest revision internally,
 * so we always get the revision with actual schema data (not the v0 seed).
 *
 * Returns the same shape as `EvaluatorDto[]` so downstream consumers
 * (transforms, Annotate component) work without changes.
 */
export function useEvaluatorSchemas(
    evaluatorRefs: {id: string; slug?: string | null; name?: string | null}[] | null,
): EvaluatorDto[] {
    const ids = useMemo(() => (evaluatorRefs ?? []).map((e) => e.id), [evaluatorRefs])

    const resolvedAtom = useMemo(
        () =>
            atom((get) =>
                ids.map((id) => {
                    if (!id) return null
                    const query = get(simpleEvaluatorQueryFamily(id))
                    return (query.data as Record<string, unknown> | null) ?? null
                }),
            ),

        [ids.join(",")],
    )

    const evaluators = useAtomValue(resolvedAtom)

    return useMemo(() => {
        if (!evaluatorRefs?.length) return []

        return evaluatorRefs.map((ref, idx) => {
            const evaluator = evaluators[idx]
            const outputSchema = resolveOutputSchema(evaluator?.data)

            return {
                id: ref.id,
                name: (evaluator?.name as string) ?? ref.name ?? ref.slug ?? ref.id,
                slug: ref.slug ?? "",
                description: (evaluator?.description as string) ?? "",
                ...(evaluator?.flags ? {flags: evaluator.flags as Record<string, unknown>} : {}),
                data: {
                    ...(evaluatorData ?? {}),
                    schemas: {
                        ...(((evaluatorData?.schemas as Record<string, unknown> | undefined) ??
                            {}) as Record<string, unknown>),
                        ...(outputSchema ? {outputs: outputSchema} : {}),
                    },
                },
                created_at: (evaluator?.created_at as string) ?? "",
                created_by_id: (evaluator?.created_by_id as string) ?? "",
            } as EvaluatorDto
        })
    }, [evaluatorRefs, evaluators])
}
