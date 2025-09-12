import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {testset, TestSet, PreviewTestSet} from "@/oss/lib/Types"
import {fetchTestsets, fetchPreviewTestsets, fetchTestset} from "@/oss/services/testsets/api"

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
