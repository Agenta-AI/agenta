import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"

import {effectiveProjectIdAtom} from "./run"

export interface ApplicationReference {
    id: string
    name?: string | null
    slug?: string | null
}

export interface VariantReference {
    id: string
    name?: string | null
    slug?: string | null
    revision?: number | string | null
}

export interface TestsetReference {
    id: string
    name?: string | null
    slug?: string | null
    testcaseCount?: number | null
    columns?: string[]
}

const normalizeApplication = (value: any, fallbackId: string): ApplicationReference => {
    const source = value?.app ?? value ?? {}
    return {
        id: source?.id ?? fallbackId,
        name: source?.name ?? source?.app_name ?? null,
        slug: source?.slug ?? source?.app_slug ?? null,
    }
}

const normalizeVariant = (value: any, fallbackId: string): VariantReference => {
    const source = value?.variant ?? value ?? {}
    return {
        id: source?.id ?? fallbackId,
        name: source?.variant_name ?? source?.name ?? source?.slug ?? null,
        slug: source?.slug ?? null,
        revision: source?.revision ?? source?.version ?? null,
    }
}

const normalizeTestset = (value: any, fallbackId: string): TestsetReference => {
    const source = value?.testset ?? value ?? {}
    const rawTestcases = Array.isArray(source?.testcases) ? source.testcases : []
    const rawIds = Array.isArray(source?.testcase_ids) ? source.testcase_ids : []
    const responseCount = typeof value?.count === "number" ? value.count : null
    const explicitColumns = Array.isArray(source?.columns)
        ? source.columns
        : Array.isArray(source?.meta?.columns)
          ? source.meta.columns
          : null

    let derivedColumns: string[] | undefined
    if (explicitColumns && explicitColumns.length) {
        derivedColumns = Array.from(new Set(explicitColumns.map(String)))
    } else if (rawTestcases.length) {
        const columnSet = new Set<string>()
        rawTestcases.forEach((testcase: any) => {
            if (!testcase || typeof testcase !== "object") return
            Object.keys(testcase).forEach((key) => {
                if (!key || key === "testcase_id" || key.startsWith("__")) return
                columnSet.add(key)
            })
            const nestedData = testcase?.data
            if (nestedData && typeof nestedData === "object") {
                Object.keys(nestedData).forEach((key) => {
                    if (!key || key.startsWith("__")) return
                    columnSet.add(key)
                })
            }
        })
        if (columnSet.size) {
            derivedColumns = Array.from(columnSet).sort()
        }
    }

    const testcaseCount = responseCount ?? (rawTestcases.length || rawIds.length || null)

    return {
        id: source?.id ?? fallbackId,
        name: source?.name ?? null,
        slug: source?.slug ?? null,
        testcaseCount,
        columns: derivedColumns,
    }
}

export const applicationReferenceQueryAtomFamily = atomFamily((appId: string | null | undefined) =>
    atomWithQuery<ApplicationReference | null>((get) => {
        const projectId = get(effectiveProjectIdAtom)
        return {
            queryKey: ["preview", "evaluation", "application-details", projectId, appId],
            enabled: Boolean(projectId && appId),
            staleTime: 60_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async () => {
                if (!projectId || !appId) return null
                try {
                    const response = await axios.get(`/apps/${appId}`, {
                        params: {project_id: projectId},
                    })
                    return normalizeApplication(response.data, appId)
                } catch (error) {
                    console.warn("[EvalRunDetails2] Failed to resolve application", {
                        projectId,
                        appId,
                        error,
                    })
                    return {id: appId}
                }
            },
        }
    }),
)

export const variantReferenceQueryAtomFamily = atomFamily((variantId: string | null | undefined) =>
    atomWithQuery<VariantReference | null>((get) => {
        const projectId = get(effectiveProjectIdAtom)
        return {
            queryKey: ["preview", "evaluation", "variant-details", projectId, variantId],
            enabled: Boolean(projectId && variantId),
            staleTime: 60_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async () => {
                if (!projectId || !variantId) return null
                try {
                    const response = await axios.get(`/variants/${variantId}`, {
                        params: {project_id: projectId},
                        _ignoreError: true,
                    } as any)
                    return normalizeVariant(response.data, variantId)
                } catch (error) {
                    console.warn("[EvalRunDetails2] Failed to resolve variant", {
                        projectId,
                        variantId,
                        error,
                    })
                    return {id: variantId}
                }
            },
        }
    }),
)

export const testsetReferenceQueryAtomFamily = atomFamily((testsetId: string | null | undefined) =>
    atomWithQuery<TestsetReference | null>((get) => {
        const projectId = get(effectiveProjectIdAtom)
        return {
            queryKey: ["preview", "evaluation", "testset-details", projectId, testsetId],
            enabled: Boolean(projectId && testsetId),
            staleTime: 60_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async () => {
                if (!projectId || !testsetId) return null
                try {
                    const response = await axios.get(`/preview/testsets/${testsetId}`, {
                        params: {project_id: projectId},
                    })
                    return normalizeTestset(response.data, testsetId)
                } catch (error) {
                    console.warn("[EvalRunDetails2] Failed to resolve testset", {
                        projectId,
                        testsetId,
                        error,
                    })
                    return {id: testsetId}
                }
            },
        }
    }),
)
