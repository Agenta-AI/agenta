import {atomWithQuery} from "jotai-tanstack-query"

import {testset} from "@/oss/lib/Types"
import {fetchPreviewTestsets} from "@/oss/services/testsets/api"

import {projectIdAtom} from "../../project"

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
