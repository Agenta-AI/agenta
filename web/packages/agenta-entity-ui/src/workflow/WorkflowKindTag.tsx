import {memo} from "react"

import {cn} from "@agenta/ui"
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
const WorkflowKindTag = memo(({isEvaluator, className}: WorkflowKindTagProps) => (
    <Badge variant={isEvaluator ? "purple" : "blue"} className={cn(className)}>
        {isEvaluator ? "Evaluator" : "App"}
    </Badge>
))

WorkflowKindTag.displayName = "WorkflowKindTag"

export default WorkflowKindTag
