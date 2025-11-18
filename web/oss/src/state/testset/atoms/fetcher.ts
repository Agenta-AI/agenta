import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {testset} from "@/oss/lib/Types"
import {fetchTestsets, fetchPreviewTestsets} from "@/oss/services/testsets/api"
import {PreviewTestsetsQueryPayload} from "@/oss/services/testsets/api/types"

import {projectIdAtom} from "../../project"

// Local options type for enabling/disabling queries
interface TestsetsQueryOptions {
    enabled?: boolean
}

/**
 * Atom for fetching regular/legacy testsets
 */
export const testsetsQueryAtom = atomWithQuery<testset[]>((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["testsets", projectId],
        queryFn: () => {
            return fetchTestsets()
        },
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        enabled: !!projectId,
    }
})

/**
 * Atom family for fetching preview testsets with filters
 */
export const previewTestsetsQueryAtomFamily = atomFamily(
    ({
        payload = {},
        enabled = true,
    }: {payload?: PreviewTestsetsQueryPayload; enabled?: boolean} = {}) =>
        atomWithQuery<testset[]>((get) => {
            const projectId = get(projectIdAtom)

            const payloadKey = JSON.stringify(payload || {})

            return {
                queryKey: ["preview-testsets", projectId, payloadKey],
                queryFn: () => fetchPreviewTestsets(payload),
                staleTime: 1000 * 60,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                refetchOnMount: false,
                enabled: enabled && !!projectId,
            }
        }),
)

export const testsetsQueryAtomFamily = atomFamily(({enabled = true}: TestsetsQueryOptions = {}) =>
    atomWithQuery<testset[]>((get) => {
        const projectId = get(projectIdAtom)

        return {
            queryKey: ["testsets", projectId],
            queryFn: fetchTestsets,
            staleTime: 1000 * 60,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            refetchOnMount: false,
            enabled: enabled && !!projectId,
        }
    }),
)

/**
 * Atom for fetching preview testsets
 */
export const previewTestsetsQueryAtom = atomWithQuery<testset[]>((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["preview-testsets", projectId],
        queryFn: () => {
            if (process.env.NODE_ENV === "development") {
                console.log("previewTestsetsQueryAtom")
            }
            return fetchPreviewTestsets()
        },
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        enabled: !!projectId,
    }
})
