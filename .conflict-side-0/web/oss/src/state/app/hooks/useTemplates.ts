import {useMemo} from "react"

import {type WorkflowCatalogTemplate} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import {templatesDataAtom} from "../atoms/templates"

const EMPTY_TEMPLATES: WorkflowCatalogTemplate[] = []

/**
 * Hook for fetching workflow catalog templates.
 * Returns catalog templates for application-type workflows.
 */
export const useTemplates = () => {
    const {templates, noTemplateMessage, isLoading, error, refetch} =
        useAtomValue(templatesDataAtom)

    const returnValue = useMemo(() => {
        return [
            {
                data: templates || EMPTY_TEMPLATES,
                error,
                isLoading,
                isValidating: isLoading,
                mutate: refetch,
            },
            noTemplateMessage,
        ] as const
    }, [templates, noTemplateMessage, isLoading, error, refetch])

    return returnValue
}
