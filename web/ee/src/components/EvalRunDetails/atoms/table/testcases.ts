import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import type {PreviewTestCase} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"
import createBatchFetcher, {BatchFetcher} from "@/oss/state/utils/createBatchFetcher"

import {activeEvaluationRunIdAtom} from "../previewRun"

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

export const evaluationTestcaseBatcherAtom = atom((get) => {
    const {projectId} = getProjectValues()
    const runId = get(activeEvaluationRunIdAtom)
    if (!projectId) return null

    const cacheKey = `${projectId}:${runId ?? "preview"}`
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
                    `/preview/simple/testsets/testcases/query`,
                    {testcase_ids: uniqueIds},
                    {
                        params: {project_id: projectId},
                    },
                )

                const rows = Array.isArray(response.data?.testcases) ? response.data.testcases : []

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
})

export const evaluationTestcaseQueryAtomFamily = atomFamily((testcaseId: string) =>
    atomWithQuery<PreviewTestCase | null>((get) => {
        const {projectId} = getProjectValues()
        const runId = get(activeEvaluationRunIdAtom)
        const batcher = get(evaluationTestcaseBatcherAtom)

        return {
            queryKey: ["preview", "evaluation-testcase", runId, projectId, testcaseId],
            enabled: Boolean(projectId && batcher && testcaseId),
            staleTime: 30_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
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
