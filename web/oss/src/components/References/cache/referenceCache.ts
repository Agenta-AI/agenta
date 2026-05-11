/**
 * Cache for reference data (evaluators).
 * This allows cells that scroll out of view and back to instantly
 * display their previously fetched data without re-triggering loading states.
 */

import type {EvaluatorReference} from "../atoms/entityReferences"

const evaluatorReferenceCache = new Map<string, EvaluatorReference>()

export const buildEvaluatorCacheKey = (
    projectId: string,
    slug?: string | null,
    id?: string | null,
): string => `${projectId}|${slug ?? ""}|${id ?? ""}`

export const getCachedEvaluatorReference = (
    projectId: string,
    slug?: string | null,
    id?: string | null,
): EvaluatorReference | undefined => {
    const key = buildEvaluatorCacheKey(projectId, slug, id)
    return evaluatorReferenceCache.get(key)
}

export const setCachedEvaluatorReference = (
    projectId: string,
    slug: string | null | undefined,
    id: string | null | undefined,
    reference: EvaluatorReference,
): void => {
    const key = buildEvaluatorCacheKey(projectId, slug, id)
    evaluatorReferenceCache.set(key, reference)
}

export const clearAllReferenceCaches = (): void => {
    evaluatorReferenceCache.clear()
}

export const clearEvaluatorReferenceCache = (): void => evaluatorReferenceCache.clear()
