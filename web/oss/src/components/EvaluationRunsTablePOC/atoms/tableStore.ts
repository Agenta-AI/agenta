import {atom} from "jotai"
import type {PrimitiveAtom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithStorage} from "jotai/vanilla/utils"

import {createInfiniteDatasetStore} from "@/oss/components/InfiniteVirtualTable"
import type {WindowingState} from "@/oss/components/InfiniteVirtualTable/types"

import type {
    EvaluationRunApiRow,
    EvaluationRunTableRow,
    EvaluationRunKind,
    ConcreteEvaluationRunKind,
} from "../types"
import {buildReferencePayload} from "../utils/referencePayload"

import {
    computeContextSignature,
    evaluationRunsMetaContextSliceAtom,
    evaluationRunsTableFetchEnabledAtom,
} from "./context"
import {fetchEvaluationRunsWindow} from "./fetchAutoEvaluationRuns"

import type {RunFlagsFilter} from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations/index"

export interface EvaluationRunsTableMeta {
    projectId: string | null
    appIds: string[]
    includePreview: boolean
    previewFlags?: RunFlagsFilter
    previewReferences?: any[]
    previewSearchQuery?: string | null
    evaluationKind: EvaluationRunKind
    statusFilters?: string[] | null
    referenceFilters?: Record<string, string[]> | null
    evaluationTypeFilters?: ConcreteEvaluationRunKind[] | null
    dateRange?: {from?: string | null; to?: string | null} | null
    /** Internal refresh trigger - incrementing this forces a refetch */
    _refreshTrigger?: number
}

interface EvaluationRunsTableMetaState {
    previewFlags?: RunFlagsFilter
    previewSearchQuery?: string | null
    statusFilters?: string[] | null
    referenceFilters?: Record<string, string[]> | null
    evaluationTypeFilters?: ConcreteEvaluationRunKind[] | null
    dateRange?: {from?: string | null; to?: string | null} | null
    contextSignature: string | null
    version: number
}

const createInitialMetaState = (signature: string | null): EvaluationRunsTableMetaState => ({
    previewFlags: undefined,
    previewSearchQuery: null,
    statusFilters: null,
    referenceFilters: null,
    evaluationTypeFilters: null,
    dateRange: null,
    contextSignature: signature,
    version: 0,
})

const evaluationRunsMetaStateAtomFamily = atomFamily<
    string | null,
    PrimitiveAtom<EvaluationRunsTableMetaState>
>(
    (signature: string | null): PrimitiveAtom<EvaluationRunsTableMetaState> => {
        const initial = createInitialMetaState(signature)
        if (!signature || typeof window === "undefined") {
            return atom(initial)
        }
        return atomWithStorage<EvaluationRunsTableMetaState>(
            `evaluation-runs:filters:${signature}`,
            initial,
        )
    },
    (a, b) => a === b,
)

const arrayEqualsNullable = (a: string[] | null, b: string[] | null) => {
    if (a === b) return true
    if (!a || !b) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false
    }
    return true
}

const shallowEqualReferences = (
    a: Record<string, string[]> | null,
    b: Record<string, string[]> | null,
) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const shallowEqualFlags = (a?: RunFlagsFilter, b?: RunFlagsFilter) => {
    if (!a && !b) return true
    if (!a || !b) return false
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) => a[key as keyof RunFlagsFilter] === b[key as keyof RunFlagsFilter])
}

const dateRangesEqual = (
    a: {from?: string | null; to?: string | null} | null | undefined,
    b: {from?: string | null; to?: string | null} | null | undefined,
) => {
    const fromA = a?.from ?? null
    const toA = a?.to ?? null
    const fromB = b?.from ?? null
    const toB = b?.to ?? null
    return fromA === fromB && toA === toB
}

const mergeLockedAppFilters = (
    referenceFilters: Record<string, string[]> | null,
    lockedAppIds: string[],
): Record<string, string[]> | null => {
    const normalizedLocked = Array.from(
        new Set(
            lockedAppIds
                .map((id) => (typeof id === "string" ? id.trim() : ""))
                .filter((id): id is string => id.length > 0),
        ),
    )

    const base = referenceFilters ? {...referenceFilters} : {}

    if (normalizedLocked.length) {
        const existingAppFilters = Array.isArray(base.app) ? base.app : []
        const mergedAppFilters = Array.from(
            new Set(
                [...normalizedLocked, ...existingAppFilters]
                    .map((id) => (typeof id === "string" ? id.trim() : ""))
                    .filter((id): id is string => id.length > 0),
            ),
        )
        base.app = mergedAppFilters
    }

    return Object.keys(base).length ? base : null
}

/**
 * Atom to trigger a refresh of the evaluation runs table.
 * Incrementing this will cause the table to refetch data.
 */
export const evaluationRunsRefreshTriggerAtom = atom(0)

/**
 * Write-only atom to invalidate the evaluation runs table and trigger a refetch.
 * Call this after updating a run (rename, status change, annotation, etc.)
 */
export const invalidateEvaluationRunsTableAtom = atom(null, (get, set) => {
    set(evaluationRunsRefreshTriggerAtom, (prev) => prev + 1)
})

export const evaluationRunsTableMetaAtom = atom<
    EvaluationRunsTableMeta,
    [EvaluationRunsTableMeta | ((prev: EvaluationRunsTableMeta) => EvaluationRunsTableMeta)],
    void
>(
    (get) => {
        const context = get(evaluationRunsMetaContextSliceAtom)
        const signature = computeContextSignature(context)
        const state = get(evaluationRunsMetaStateAtomFamily(signature))
        const isEnabled = get(evaluationRunsTableFetchEnabledAtom)
        const refreshTrigger = get(evaluationRunsRefreshTriggerAtom)

        const previewFlags = state.previewFlags ?? context.derivedPreviewFlags

        const statusFilters = state.statusFilters ?? null
        const lockedAppIds =
            context.scope === "app"
                ? context.effectiveAppIds
                : context.activeAppId
                  ? [context.activeAppId]
                  : []

        // No need to fetch evaluators here - the API accepts both slugs and IDs
        // via buildReferencePayload which handles the conversion
        const referenceFilters = mergeLockedAppFilters(state.referenceFilters ?? null, lockedAppIds)
        const previewSearchQuery = state.previewSearchQuery ?? null
        const previewReferences = buildReferencePayload(referenceFilters)
        const evaluationTypeFilters = state.evaluationTypeFilters ?? null
        const dateRange = state.dateRange ?? null

        const meta: EvaluationRunsTableMeta = {
            projectId: isEnabled ? context.projectId : null,
            appIds: isEnabled ? context.effectiveAppIds : [],
            includePreview: context.includePreview,
            previewFlags,
            previewReferences,
            previewSearchQuery,
            evaluationKind: context.evaluationKind,
            statusFilters,
            referenceFilters,
            evaluationTypeFilters,
            dateRange,
            _refreshTrigger: refreshTrigger,
        }

        return meta
    },
    (get, set, update) => {
        const current = get(evaluationRunsTableMetaAtom)
        const context = get(evaluationRunsMetaContextSliceAtom)
        const signature = computeContextSignature(context)
        const stateAtom = evaluationRunsMetaStateAtomFamily(
            signature,
        ) as PrimitiveAtom<EvaluationRunsTableMetaState>
        const state = get(stateAtom)
        const next = typeof update === "function" ? update(current) : update

        const nextPreviewFlags = next.previewFlags
        const nextPreviewSearch = next.previewSearchQuery ?? null
        const nextStatusFilters = next.statusFilters ?? null
        const nextReferenceFilters = next.referenceFilters ?? null
        const nextEvaluationTypes = next.evaluationTypeFilters ?? null
        const nextDateRange = next.dateRange ?? null

        const flagsChanged = !shallowEqualFlags(state.previewFlags, nextPreviewFlags)
        const searchChanged = (state.previewSearchQuery ?? null) !== nextPreviewSearch
        const statusChanged = !arrayEqualsNullable(state.statusFilters ?? null, nextStatusFilters)
        const referencesChanged = !shallowEqualReferences(
            state.referenceFilters ?? null,
            nextReferenceFilters,
        )
        const evaluationTypesChanged = !arrayEqualsNullable(
            state.evaluationTypeFilters ?? null,
            nextEvaluationTypes,
        )
        const dateRangeChanged = !dateRangesEqual(state.dateRange ?? null, nextDateRange)
        const valuesChanged =
            flagsChanged ||
            searchChanged ||
            statusChanged ||
            referencesChanged ||
            evaluationTypesChanged ||
            dateRangeChanged
        const versionBump = next !== current || valuesChanged

        if (!valuesChanged && !versionBump) {
            return
        }

        ;(
            set as unknown as (
                target: PrimitiveAtom<EvaluationRunsTableMetaState>,
                next: EvaluationRunsTableMetaState,
            ) => void
        )(stateAtom, {
            contextSignature: signature,
            previewFlags: nextPreviewFlags,
            previewSearchQuery: nextPreviewSearch,
            statusFilters: nextStatusFilters,
            referenceFilters: nextReferenceFilters,
            evaluationTypeFilters: nextEvaluationTypes,
            dateRange: nextDateRange,
            version: versionBump ? state.version + 1 : state.version,
        })
    },
)

export const evaluationRunsMetaVersionAtom = atom((get) => {
    const context = get(evaluationRunsMetaContextSliceAtom)
    const signature = computeContextSignature(context)
    return get(evaluationRunsMetaStateAtomFamily(signature)).version
})

export const createEvaluationRunSkeletonRow = ({
    scopeId,
    offset,
    index,
    rowKey,
}: {
    scopeId: string | null
    offset: number
    index: number
    windowing: WindowingState | null
    rowKey: string
}): EvaluationRunTableRow => {
    const computedIndex = offset + index + 1
    const scopePrefix = scopeId ? `${scopeId}::` : ""
    const key = `${scopePrefix}skeleton-run-${computedIndex}-${rowKey}`

    return {
        key,
        projectId: null,
        runId: null,
        source: "preview",
        appId: null,
        createdAt: null,
        status: "loading",
        legacy: undefined,
        preview: undefined,
        previewMeta: null,
        __isSkeleton: true,
        evaluationKind: undefined,
    }
}

const mergeRow = ({
    skeleton,
    apiRow,
}: {
    skeleton: EvaluationRunTableRow
    apiRow?: EvaluationRunApiRow
}): EvaluationRunTableRow => {
    if (!apiRow) {
        return skeleton
    }

    return {
        ...skeleton,
        key: apiRow.key ?? skeleton.key,
        projectId: apiRow.projectId ?? skeleton.projectId,
        runId: apiRow.runId ?? skeleton.runId,
        source: apiRow.source ?? skeleton.source,
        appId: apiRow.appId ?? skeleton.appId,
        createdAt: apiRow.createdAt ?? skeleton.createdAt,
        status: apiRow.status ?? skeleton.status,
        legacy: apiRow.legacy ?? skeleton.legacy,
        preview: apiRow.preview ?? skeleton.preview,
        previewMeta: apiRow.previewMeta ?? skeleton.previewMeta ?? null,
        __isSkeleton: false,
        evaluationKind: apiRow.evaluationKind ?? skeleton.evaluationKind,
    }
}

const evaluationRunsDatasetStoreInternal = createInfiniteDatasetStore<
    EvaluationRunTableRow,
    EvaluationRunApiRow,
    EvaluationRunsTableMeta
>({
    key: "evaluation-runs-table",
    metaAtom: evaluationRunsTableMetaAtom,
    createSkeletonRow: createEvaluationRunSkeletonRow,
    mergeRow,
    isEnabled: (meta) => Boolean(meta?.projectId),
    fetchPage: async ({limit, offset, cursor, meta, windowing}) => {
        if (!meta.projectId) {
            return {
                rows: [],
                totalCount: 0,
                hasMore: false,
                nextOffset: null,
                nextCursor: null,
                nextWindowing: null,
            }
        }

        if (process.env.NODE_ENV !== "production") {
            console.log("[evaluationRunsTableStore] fetchPage", {
                limit,
                offset,
                cursor,
                kind: meta.evaluationKind,
                includePreview: meta.includePreview,
                appIds: meta.appIds,
            })
        }

        const result = await fetchEvaluationRunsWindow({
            projectId: meta.projectId,
            appIds: meta.appIds ?? [],
            limit,
            offset,
            cursor,
            includePreview: meta.includePreview,
            evaluationKind: meta.evaluationKind,
            previewFlags: meta.previewFlags,
            previewReferences: meta.previewReferences,
            previewSearchQuery: meta.previewSearchQuery,
            statusFilters: meta.statusFilters ?? null,
            evaluationTypeFilters: meta.evaluationTypeFilters ?? null,
            dateRange: meta.dateRange ?? null,
        })

        return {
            rows: result.rows,
            totalCount: result.totalCount,
            hasMore: result.hasMore,
            nextOffset: result.nextOffset,
            nextCursor: result.nextCursor,
            nextWindowing: result.nextWindowing,
        }
    },
})

export const evaluationRunsDatasetStore = evaluationRunsDatasetStoreInternal
export const evaluationRunsTableStore = evaluationRunsDatasetStoreInternal.store

export const mapEvaluationRunApiToTableRow = (
    apiRow: EvaluationRunApiRow,
): EvaluationRunTableRow => ({
    key: apiRow.key,
    source: apiRow.source,
    projectId: apiRow.projectId,
    runId: apiRow.runId,
    createdAt: apiRow.createdAt ?? null,
    status: apiRow.status ?? null,
    appId: apiRow.appId ?? null,
    legacy: apiRow.legacy,
    preview: apiRow.preview,
    previewMeta: apiRow.previewMeta ?? null,
    __isSkeleton: false,
    evaluationKind: apiRow.evaluationKind,
})

export const buildSkeletonRows = ({
    scopeId,
    offset,
    count,
}: {
    scopeId: string | null
    offset: number
    count: number
}) =>
    Array.from({length: count}, (_, index) =>
        createEvaluationRunSkeletonRow({
            scopeId,
            offset,
            index,
            windowing: null,
            rowKey: `evaluation-run-skeleton-${scopeId ?? "scope"}-${offset + index}`,
        }),
    )

export const EVALUATION_RUNS_QUERY_KEY_ROOT = ["evaluation-runs-table"] as const
