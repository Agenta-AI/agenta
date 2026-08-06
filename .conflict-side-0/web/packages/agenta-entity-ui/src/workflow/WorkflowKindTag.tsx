import {memo} from "react"

import {cn} from "@agenta/ui"
import {Tag} from "antd"

export interface WorkflowKindTagProps {
    isEvaluator: boolean
    className?: string
}

/**
 * "Kind" pill for a workflow row — `App` for applications, `Evaluator` for
 * evaluator workflows. Uses Ant preset colors (`blue`/`purple`) so it stays
 * visually distinct from the category-palette `WorkflowTypeTag`.
 */
const WorkflowKindTag = memo(({isEvaluator, className}: WorkflowKindTagProps) => (
    <Tag color={isEvaluator ? "purple" : "blue"} className={cn(className)}>
        {isEvaluator ? "Evaluator" : "App"}
    </Tag>
))

WorkflowKindTag.displayName = "WorkflowKindTag"

export default WorkflowKindTag
