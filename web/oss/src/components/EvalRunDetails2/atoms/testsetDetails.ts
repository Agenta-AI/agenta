import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"

import {effectiveProjectIdAtom} from "./run"

export interface SimpleTestsetDetails {
    id: string
    name?: string | null
    slug?: string | null
    description?: string | null
    testcaseCount: number | null
    columnNames: string[]
    hasTestcases?: boolean
    hasTraces?: boolean
}

const normalizeSimpleTestset = (value: any, fallbackId: string): SimpleTestsetDetails => {
    const source = value?.testset ?? value ?? {}
    const responseCount = typeof value?.count === "number" ? value.count : null

    const rawTestcases = Array.isArray(source?.data?.testcases)
        ? (source.data.testcases as Record<string, any>[])
        : []
    const rawIds = Array.isArray(source?.data?.testcase_ids)
        ? (source.data.testcase_ids as (string | null | undefined)[])
        : []
    const filteredIds = rawIds.filter((value): value is string => Boolean(value))

    const columnSet = new Set<string>()
    rawTestcases.forEach((testcase) => {
        if (!testcase || typeof testcase !== "object") return
        const data = testcase.data
        if (data && typeof data === "object") {
            Object.keys(data).forEach((key) => {
                if (!key || key.startsWith("__") || key === "testcase_dedup_id") return
                columnSet.add(key)
            })
        }
    })

    const testcaseCount =
        filteredIds.length > 0
            ? filteredIds.length
            : rawTestcases.length > 0
              ? rawTestcases.length
              : responseCount !== null
                ? responseCount
                : null

    const flags = source?.flags ?? {}

    return {
        id: source?.id ?? fallbackId,
        name: source?.name ?? null,
        slug: source?.slug ?? null,
        description: source?.description ?? null,
        testcaseCount,
        columnNames: columnSet.size ? Array.from(columnSet).sort() : [],
        hasTestcases: Boolean(flags?.has_testcases ?? flags?.hasTestcases),
    }
}

export const simpleTestsetDetailsAtomFamily = atomFamily((testsetId: string | null | undefined) =>
    atomWithQuery<SimpleTestsetDetails | null>((get) => {
        const projectId = get(effectiveProjectIdAtom)
        const enabled = Boolean(projectId && testsetId)

        return {
            queryKey: ["preview", "evaluation", "testset-simple-details", projectId, testsetId],
            enabled,
            staleTime: 60_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async () => {
                if (!enabled || !projectId || !testsetId) return null

                const response = await axios.get(`/preview/simple/testsets/${testsetId}`, {
                    params: {project_id: projectId},
                })

                return normalizeSimpleTestset(response.data, testsetId)
            },
        }
    }),
)
