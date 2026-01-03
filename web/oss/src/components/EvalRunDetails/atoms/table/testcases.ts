import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import type {PreviewTestCase} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"
import createBatchFetcher, {BatchFetcher} from "@/oss/state/utils/createBatchFetcher"

import {resolveTestcaseValueByPath, splitPath} from "../../utils/valueAccess"
import {activePreviewRunIdAtom, effectiveProjectIdAtom} from "../run"

const testcaseBatcherCache = new Map<string, BatchFetcher<string, PreviewTestCase | null>>()

const normalizeTestcase = (raw: any): PreviewTestCase | null => {
    if (!raw) return null
    const id = raw.id ?? raw.testcase_id
    if (!id) return null

    const testsetId =
        raw.testset_id ?? raw.testsetId ?? raw.set_id ?? raw.setId ?? raw.testsetId ?? ""
    const setId = raw.set_id ?? raw.setId ?? testsetId

    return {
        ...raw,
        id,
        testset_id: testsetId,
        set_id: setId,
        created_at: raw.created_at ?? raw.createdAt ?? "",
        updated_at: raw.updated_at ?? raw.updatedAt ?? "",
        created_by_id: raw.created_by_id ?? raw.createdById ?? "",
        data: raw.data ?? raw.inputs ?? {},
    }
}

const resolveEffectiveRunId = (get: any, runId?: string | null) =>
    runId ?? get(activePreviewRunIdAtom) ?? undefined

export const evaluationTestcaseBatcherFamily = atomFamily(({runId}: {runId?: string | null} = {}) =>
    atom((get) => {
        const {projectId: globalProjectId} = getProjectValues()
        const projectId = globalProjectId ?? get(effectiveProjectIdAtom)
        const effectiveRunId = resolveEffectiveRunId(get, runId)
        if (!projectId) return null

        const cacheKey = `${projectId}:${effectiveRunId ?? "preview"}`
        let batcher = testcaseBatcherCache.get(cacheKey)
        if (!batcher) {
            testcaseBatcherCache.clear()
            batcher = createBatchFetcher<string, PreviewTestCase | null>({
                serializeKey: (key) => key,
                batchFn: async (testcaseIds) => {
                    const uniqueIds = Array.from(new Set(testcaseIds.filter(Boolean)))
                    if (uniqueIds.length === 0) {
                        return {}
                    }

                    const response = await axios.post(
                        `/preview/testcases/query`,
                        {testcase_ids: uniqueIds},
                        {
                            params: {project_id: projectId},
                        },
                    )

                    const rows = Array.isArray(response.data?.testcases)
                        ? response.data.testcases
                        : []

                    const result: Record<string, PreviewTestCase | null> = Object.create(null)
                    rows.forEach((row: any) => {
                        const normalized = normalizeTestcase(row)
                        if (normalized?.id) {
                            result[normalized.id] = normalized
                        }
                    })

                    uniqueIds.forEach((id) => {
                        if (typeof result[id] === "undefined") {
                            result[id] = null
                        }
                    })

                    return result
                },
            })
            testcaseBatcherCache.set(cacheKey, batcher)
        }

        return batcher
    }),
)

export const evaluationTestcaseBatcherAtom = atom((get) => get(evaluationTestcaseBatcherFamily()))

export const evaluationTestcaseQueryAtomFamily = atomFamily(
    ({testcaseId, runId}: {testcaseId: string; runId?: string | null}) =>
        atomWithQuery<PreviewTestCase | null>((get) => {
            const {projectId: globalProjectId} = getProjectValues()
            const projectId = globalProjectId ?? get(effectiveProjectIdAtom)
            const effectiveRunId = resolveEffectiveRunId(get, runId)
            const batcher = get(evaluationTestcaseBatcherFamily({runId: effectiveRunId}))

            return {
                queryKey: ["preview", "evaluation-testcase", effectiveRunId, projectId, testcaseId],
                enabled: Boolean(projectId && batcher && testcaseId),
                staleTime: 30_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                structuralSharing: true,
                queryFn: async () => {
                    if (!batcher) {
                        throw new Error("Testcase batcher is not initialised")
                    }
                    const value = await batcher(testcaseId)
                    return value ?? null
                },
            }
        }),
)

export const testcaseValueAtomFamily = atomFamily(
    ({testcaseId, path, runId}: {testcaseId: string; path: string; runId?: string | null}) =>
        selectAtom(
            evaluationTestcaseQueryAtomFamily({testcaseId, runId}),
            (queryState) => resolveTestcaseValueByPath(queryState.data, splitPath(path)),
            Object.is,
        ),
)

export const testcaseQueryMetaAtomFamily = atomFamily(
    ({testcaseId, runId}: {testcaseId: string; runId?: string | null}) =>
        selectAtom(
            evaluationTestcaseQueryAtomFamily({testcaseId, runId}),
            (queryState) => ({
                isLoading: queryState.isLoading,
                isFetching: queryState.isFetching,
                error: queryState.error,
            }),
            (a, b) =>
                a.isLoading === b.isLoading && a.isFetching === b.isFetching && a.error === b.error,
        ),
)
