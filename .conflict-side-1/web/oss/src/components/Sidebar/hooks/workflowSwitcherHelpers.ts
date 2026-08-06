import type {Workflow} from "@agenta/entities/workflow"

import type {WorkflowKind} from "@/oss/state/workflow"

export const resolveIsEvaluatorWorkflow = ({
    workflowId,
    workflowKind,
    evaluators,
}: {
    workflowId: string | null
    workflowKind: WorkflowKind | null
    evaluators: readonly Workflow[]
}) =>
    workflowKind === "evaluator" ||
    Boolean(workflowId && evaluators.some((evaluator) => evaluator.id === workflowId))
