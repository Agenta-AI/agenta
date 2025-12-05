/**
 * Cache for reference data (apps, testsets, variants, evaluators).
 * This allows cells that scroll out of view and back to instantly
 * display their previously fetched data without re-triggering loading states.
 */

import type {
    AppReference,
    EvaluatorReference,
    TestsetReference,
    VariantConfigReference,
} from "../atoms/entityReferences"

// Separate caches for each reference type
const appReferenceCache = new Map<string, AppReference>()
const testsetReferenceCache = new Map<string, TestsetReference>()
const variantConfigCache = new Map<string, VariantConfigReference>()
const evaluatorReferenceCache = new Map<string, EvaluatorReference>()

// Cache key builders
export const buildAppCacheKey = (projectId: string, appId: string): string =>
    `${projectId}|${appId}`

export const buildTestsetCacheKey = (projectId: string, testsetId: string): string =>
    `${projectId}|${testsetId}`

export const buildVariantConfigCacheKey = (projectId: string, revisionId: string): string =>
    `${projectId}|${revisionId}`

export const buildEvaluatorCacheKey = (
    projectId: string,
    slug?: string | null,
    id?: string | null,
): string => `${projectId}|${slug ?? ""}|${id ?? ""}`

// App reference cache operations
export const getCachedAppReference = (
    projectId: string,
    appId: string,
): AppReference | undefined => {
    const key = buildAppCacheKey(projectId, appId)
    return appReferenceCache.get(key)
}

export const setCachedAppReference = (
    projectId: string,
    appId: string,
    reference: AppReference,
): void => {
    const key = buildAppCacheKey(projectId, appId)
    appReferenceCache.set(key, reference)
}

// Testset reference cache operations
export const getCachedTestsetReference = (
    projectId: string,
    testsetId: string,
): TestsetReference | undefined => {
    const key = buildTestsetCacheKey(projectId, testsetId)
    return testsetReferenceCache.get(key)
}

export const setCachedTestsetReference = (
    projectId: string,
    testsetId: string,
    reference: TestsetReference,
): void => {
    const key = buildTestsetCacheKey(projectId, testsetId)
    testsetReferenceCache.set(key, reference)
}

// Variant config cache operations
export const getCachedVariantConfig = (
    projectId: string,
    revisionId: string,
): VariantConfigReference | undefined => {
    const key = buildVariantConfigCacheKey(projectId, revisionId)
    return variantConfigCache.get(key)
}

export const setCachedVariantConfig = (
    projectId: string,
    revisionId: string,
    config: VariantConfigReference,
): void => {
    const key = buildVariantConfigCacheKey(projectId, revisionId)
    variantConfigCache.set(key, config)
}

// Evaluator reference cache operations
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

// Clear all caches
export const clearAllReferenceCaches = (): void => {
    appReferenceCache.clear()
    testsetReferenceCache.clear()
    variantConfigCache.clear()
    evaluatorReferenceCache.clear()
}

// Clear individual caches
export const clearAppReferenceCache = (): void => appReferenceCache.clear()
export const clearTestsetReferenceCache = (): void => testsetReferenceCache.clear()
export const clearVariantConfigCache = (): void => variantConfigCache.clear()
export const clearEvaluatorReferenceCache = (): void => evaluatorReferenceCache.clear()
