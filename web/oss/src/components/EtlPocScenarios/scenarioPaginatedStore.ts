/**
 * Thin scenario paginated store — `{id, key}` only.
 *
 * Mirrors the `testcasePaginatedStore` convention from the entities
 * package: the row carries identity (scenario UUID), nothing else. Every
 * column's value is materialized cell-side via molecule caches (results,
 * metrics, testcases, traces) — populated by `useHydrateScenarios` at the
 * page level (filter-driven) and by `useCellMaterialization` on demand
 * (cell-level fallback for slices the predicate didn't request).
 *
 * Why this exists alongside `evaluationPreviewTableStore`:
 *   - The legacy production store writes a semi-full row shape with
 *     `scenarioId`, `testcaseId`, `status`, `createdAt`, … Useful for the
 *     UI as it stands, but the cells in *this* test page don't read any
 *     of those fields — they pull everything through molecule caches.
 *   - The thin store proves the architecture: scenarios paginated store
 *     surfaces IDs; ETL hydrate (predicate-driven) fills caches; cells
 *     read caches. Same shape as testcase / playground / etc.
 *   - Eventual production migration: replace `evaluationPreviewTableStore`
 *     with this (or an entities-package equivalent) once the full
 *     scenarios view is on the molecule-cache pattern. Out of scope here.
 *
 * Fetch path is the same as production — reuses
 * `fetchEvaluationScenarioWindow` from `EvalRunDetails/atoms/table/scenarios`
 * so backend round-trips remain identical. Only the in-row shape changes.
 */

import {createInfiniteTableStore} from "@agenta/ui/table"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {activePreviewProjectIdAtom} from "@/oss/components/EvalRunDetails/atoms/run"
import type {
    EvaluationScenarioRow,
    WindowingState,
} from "@/oss/components/EvalRunDetails/atoms/table"
import {fetchEvaluationScenarioWindow} from "@/oss/components/EvalRunDetails/atoms/table/scenarios"

/**
 * Thin row shape — identity only. Every column's value is sourced from
 * molecule caches at render time, not from this row object.
 *
 * Extends `InfiniteTableRowBase` (the IVT generic constraint) implicitly
 * via the index signature inherited from that interface — extra fields
 * are allowed, but only `key` + `__isSkeleton` carry contractual meaning
 * for the store.
 */
export interface ScenarioThinRow {
    /** IVT row identity (= scenario UUID for real rows, `${runId}::skel-N` for skeletons). */
    key: string
    /** Stable ID for `rowConfig.getRowId`. */
    id: string
    /** Scenario UUID — null on skeleton rows. Cells use this to query caches. */
    scenarioId: string | null
    __isSkeleton: boolean
    /** Index-signature compat with `InfiniteTableRowBase`. */
    [k: string]: unknown
}

interface ScenarioPaginatedMeta {
    projectId: string | null
}

const projectIdAtom = selectAtom(
    atom((get) => get(activePreviewProjectIdAtom)),
    (id) => id,
)

const createSkeletonRow = ({
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
}): ScenarioThinRow => {
    const runId = scopeId ?? ""
    const key = runId ? `${runId}::${rowKey}` : rowKey
    return {
        key,
        id: rowKey,
        scenarioId: null,
        __isSkeleton: true,
    }
}

const mergeRow = ({
    skeleton,
    apiRow,
}: {
    skeleton: ScenarioThinRow
    apiRow?: EvaluationScenarioRow
}): ScenarioThinRow => {
    if (!apiRow) return skeleton
    return {
        ...skeleton,
        scenarioId: apiRow.id,
        __isSkeleton: false,
    }
}

/**
 * Thin scenarios paginated store. scopeId = runId.
 */
export const scenarioThinPaginatedStore = createInfiniteTableStore<
    ScenarioThinRow,
    EvaluationScenarioRow,
    ScenarioPaginatedMeta
>({
    key: "etl-poc-scenarios-thin",
    createSkeletonRow,
    mergeRow,
    getQueryMeta: ({get}) => ({projectId: get(projectIdAtom)}),
    isEnabled: ({scopeId, meta}) => Boolean(scopeId && meta?.projectId),
    fetchPage: async ({scopeId, cursor, limit, offset, windowing, meta}) => {
        const projectId = meta?.projectId
        if (!scopeId || !projectId) {
            return {
                rows: [],
                totalCount: null,
                hasMore: false,
                nextOffset: null,
                nextCursor: null,
                nextWindowing: null,
            }
        }
        return fetchEvaluationScenarioWindow({
            projectId,
            runId: scopeId,
            cursor,
            limit,
            offset,
            windowing,
            order: "ascending",
        })
    },
})
