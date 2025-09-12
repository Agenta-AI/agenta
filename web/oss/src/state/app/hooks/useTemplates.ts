import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {templatesDataAtom} from "../atoms/templates"

/**
 * Hook for fetching container templates using Jotai atoms
 * Replaces the SWR-based useTemplates hook
 */
const EMPTY_TEMPLATES = []
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
