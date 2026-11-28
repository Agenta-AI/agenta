import {memo} from "react"

import {useT} from "@agenta/i18n"
import workflowTagCatalog from "@agenta/i18n/catalogs/entityUi.workflowTag"
import {cn} from "@agenta/ui/styles"
import {Badge} from "@agenta/ui/ui"

export interface WorkflowKindTagProps {
    isEvaluator: boolean
    className?: string
}

/**
 * "Kind" pill for a workflow row — `App` for applications, `Evaluator` for
 * evaluator workflows. Uses the preset tag colors (`blue`/`purple`) so it stays
 * visually distinct from the category-palette `WorkflowTypeTag`.
 */
const WorkflowKindTag = memo(({isEvaluator, className}: WorkflowKindTagProps) => {
    const t = useT(workflowTagCatalog)
    return (
        <Badge variant={isEvaluator ? "default" : "info"} className={cn(className)}>
            {isEvaluator ? t("entityUi.workflowTag.evaluator") : t("entityUi.workflowTag.app")}
        </Badge>
    )
})

WorkflowKindTag.displayName = "WorkflowKindTag"

export default WorkflowKindTag
