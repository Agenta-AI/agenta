import {useMemo} from "react"

import {
    buildEvaluatorTemplateTabs,
    evaluatorTemplatesQueryAtom,
    selectCreatableEvaluatorTemplates,
    type EvaluatorCatalogTemplate,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

const NONE: EvaluatorCatalogTemplate[] = []

/**
 * The templates a user can create an evaluator from, and the picker tabs. The catalog query
 * starts when the picker mounts, so the list page pays nothing until "Create new" is pressed.
 */
export const useEvaluatorTemplates = () => {
    const query = useAtomValue(evaluatorTemplatesQueryAtom)
    const all = query.data?.templates ?? NONE
    const templates = useMemo(() => selectCreatableEvaluatorTemplates(all), [all])
    const tabs = useMemo(() => buildEvaluatorTemplateTabs(all), [all])
    return {
        templates,
        tabs,
        isPending: query.isPending,
        isError: query.isError,
        refetch: query.refetch,
    }
}
