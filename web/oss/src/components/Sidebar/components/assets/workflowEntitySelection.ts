interface WorkflowRef {
    id: string
}

interface ResolveWorkflowEntitySelectionArgs<TWorkflow extends WorkflowRef> {
    currentWorkflow: TWorkflow | null
    currentWorkflowId: string | null
    apps: readonly TWorkflow[]
    evaluators: readonly TWorkflow[]
    recentAppId: string | null
    recentEvaluatorId: string | null
}

const findWorkflow = <TWorkflow extends WorkflowRef>(
    workflows: readonly TWorkflow[],
    id: string | null,
) => (id ? (workflows.find((workflow) => workflow.id === id) ?? null) : null)

export const resolveWorkflowEntitySelection = <TWorkflow extends WorkflowRef>({
    currentWorkflow,
    currentWorkflowId,
    apps,
    evaluators,
    recentAppId,
    recentEvaluatorId,
}: ResolveWorkflowEntitySelectionArgs<TWorkflow>): TWorkflow | null => {
    if (currentWorkflow) return currentWorkflow

    if (currentWorkflowId) {
        return (
            findWorkflow(apps, currentWorkflowId) ??
            findWorkflow(evaluators, currentWorkflowId) ??
            null
        )
    }

    return findWorkflow(apps, recentAppId) ?? findWorkflow(evaluators, recentEvaluatorId) ?? null
}
