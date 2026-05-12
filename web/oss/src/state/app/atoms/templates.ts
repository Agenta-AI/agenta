import {
    fetchWorkflowCatalogTemplates,
    type WorkflowCatalogTemplate,
} from "@agenta/entities/workflow"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {projectIdAtom} from "../../project/selectors/project"

/**
 * Atom for fetching workflow catalog templates (application type only).
 * Replaces the old container templates fetch.
 */
export const templatesQueryAtom = atomWithQuery<WorkflowCatalogTemplate[]>((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["workflow-catalog-templates", "application", projectId],
        queryFn: async () => {
            const response = await fetchWorkflowCatalogTemplates({isApplication: true})
            return response.templates
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        enabled: !!projectId,
        retry: (failureCount, error) => {
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
 * Derived atom that provides templates data and loading states.
 */
export const templatesDataAtom = atom((get) => {
    const queryResult = get(templatesQueryAtom)

    return {
        templates: queryResult.data ?? [],
        noTemplateMessage: queryResult.data?.length === 0 ? "No templates available" : "",
        isLoading: queryResult.isPending,
        error: queryResult.error,
        refetch: queryResult.refetch,
    }
})
