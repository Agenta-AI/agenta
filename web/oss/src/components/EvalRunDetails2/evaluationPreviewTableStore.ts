import type {Key} from "react"

import {atom, useAtom} from "jotai"
import {atomFamily} from "jotai/utils"

import {
    createInfiniteTableStore,
    useInfiniteTablePagination,
} from "@/oss/components/InfiniteVirtualTable"
import type {InfiniteDatasetStore} from "@/oss/components/InfiniteVirtualTable/createInfiniteDatasetStore"

import {effectiveProjectIdAtom} from "./atoms/run"
import type {WindowingState, EvaluationScenarioRow} from "./atoms/table"
import {fetchEvaluationScenarioWindow} from "./atoms/table/scenarios"
import type {PreviewTableRow} from "./atoms/tableRows"

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
}): PreviewTableRow => {
    const scenarioIndex = offset + index + 1
    const runId = scopeId ?? undefined
    const key = runId ? `${runId}::${rowKey}` : rowKey
    return {
        rowId: key,
        key,
        id: rowKey,
        scenarioId: undefined,
        runId,
        testcaseId: undefined,
        baseScenarioId: undefined,
        compareIndex: undefined,
        isComparisonRow: false,
        scenarioIndex,
        status: "loading",
        createdAt: "",
        updatedAt: "",
        createdById: undefined,
        updatedById: undefined,
        __isSkeleton: true,
    }
}

const mergeRow = ({
    skeleton,
    apiRow,
}: {
    skeleton: PreviewTableRow
    apiRow?: EvaluationScenarioRow
}): PreviewTableRow => {
    if (!apiRow) {
        return skeleton
    }

    return {
        ...skeleton,
        runId: skeleton.runId,
        scenarioId: apiRow.id,
        testcaseId: apiRow.testcaseId ?? skeleton.testcaseId,
        status: apiRow.status,
        createdAt: apiRow.createdAt,
        updatedAt: apiRow.updatedAt,
        createdById: apiRow.createdById,
        updatedById: apiRow.updatedById,
        __isSkeleton: false,
    }
}

export const evaluationPreviewTableStore = createInfiniteTableStore<
    PreviewTableRow,
    EvaluationScenarioRow
>({
    key: "evaluation-preview-table",
    createSkeletonRow,
    mergeRow,
    getQueryMeta: ({get}) => get(effectiveProjectIdAtom),
    isEnabled: ({scopeId, meta}) => Boolean(scopeId && meta),
    fetchPage: async ({scopeId, cursor, limit, offset, windowing, meta}) => {
        const projectId = meta

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
        })
    },
})

// Lightweight dataset-style adapter so we can plug into InfiniteVirtualTableFeatureShell
const rowSelectionAtomFamily = atomFamily(
    ({scopeId}: {scopeId: string | null}) => atom<Key[]>([]),
    (a, b) => a.scopeId === b.scopeId,
)

const useRowSelection = ({scopeId}: {scopeId: string | null}) =>
    useAtom(rowSelectionAtomFamily({scopeId}))

const usePagination = ({
    scopeId,
    pageSize,
    resetOnScopeChange = true,
}: {
    scopeId: string | null
    pageSize: number
    resetOnScopeChange?: boolean
}) =>
    useInfiniteTablePagination<PreviewTableRow>({
        store: evaluationPreviewTableStore,
        scopeId,
        pageSize,
        resetOnScopeChange,
    })

export const evaluationPreviewDatasetStore: InfiniteDatasetStore<
    PreviewTableRow,
    EvaluationScenarioRow,
    string | null
> = {
    store: evaluationPreviewTableStore,
    config: {
        key: "evaluation-preview-table",
        metaAtom: effectiveProjectIdAtom,
        createSkeletonRow,
        mergeRow,
        isEnabled: (meta) => Boolean(meta),
        fetchPage: async () => ({
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextOffset: null,
            nextCursor: null,
            nextWindowing: null,
        }),
    },
    atoms: {
        rowsAtom: (params) => evaluationPreviewTableStore.atoms.combinedRowsAtomFamily(params),
        paginationAtom: (params) =>
            evaluationPreviewTableStore.atoms.paginationInfoAtomFamily(params),
        selectionAtom: (params) => rowSelectionAtomFamily(params),
    },
    hooks: {
        usePagination,
        useRowSelection,
    },
}
