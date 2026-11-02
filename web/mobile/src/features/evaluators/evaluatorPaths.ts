import type {EvaluatorCategory} from "@agenta/entities/workflow"

const base = (workspaceId: string, projectId: string) =>
    `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}`

export const evaluatorsUrl = (workspaceId: string, projectId: string, tab: EvaluatorCategory) =>
    `${base(workspaceId, projectId)}/evaluators?tab=${tab}`

export const archivedEvaluatorsUrl = (
    workspaceId: string,
    projectId: string,
    tab: EvaluatorCategory,
) => `${base(workspaceId, projectId)}/evaluators/archived?tab=${tab}`
