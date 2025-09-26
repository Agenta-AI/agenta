import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {testset} from "@/oss/lib/Types"
import {fetchPreviewTestsets, fetchTestsets} from "@/oss/services/testsets/api"

import {projectIdAtom} from "../../project"

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
