import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchAllTemplates} from "@/oss/services/app-selector/api"

import {projectIdAtom} from "../../project/selectors/project"

/**
 * Atom for fetching container templates
 */
export const templatesQueryAtom = atomWithQuery<any[]>((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["templates", projectId],
        queryFn: async () => {
            const data = await fetchAllTemplates()
            return data
        },
        staleTime: 1000 * 60 * 5, // 5 minutes - templates don't change often
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        enabled: !!projectId,
        retry: (failureCount, error) => {
            // Don't retry if it's a 404 or similar client error
            if ((error as any)?.response?.status >= 400 && (error as any)?.response?.status < 500) {
                return false
            }
            return failureCount < 3
        },
    }
})

/**
 * Atom for tracking no template message state
 */
export const noTemplateMessageAtom = atom<string>("")

/**
 * Derived atom that handles the templates data and error states
 */
export const templatesDataAtom = atom((get) => {
    const queryResult = get(templatesQueryAtom)

    // Handle the case where data is a string (error message)
    if (typeof queryResult.data === "string") {
        return {
            templates: [],
            noTemplateMessage: queryResult.data,
            isLoading: queryResult.isPending,
            error: queryResult.error,
            refetch: queryResult.refetch,
        }
    }

    return {
        templates: queryResult.data ?? [],
        noTemplateMessage: "",
        isLoading: queryResult.isPending,
        error: queryResult.error,
        refetch: queryResult.refetch,
    }
})
