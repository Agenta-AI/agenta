/**
 * `/approval-choices` calls, through the generated client. Answers are checked with the zod
 * schemas before the screens read them.
 */
import {getApprovalChoicesClient} from "@agenta/sdk/resources"

import {safeParseWithLogging} from "../shared"

import {
    approvalChoiceResponseSchema,
    approvalChoicesResponseSchema,
    type ApprovalChoice,
} from "./schema"

const projectScopedRequest = (projectId: string) => ({queryParams: {project_id: projectId}})

export const createApprovalChoice = async ({
    projectId,
    workflowId,
    toolKey,
}: {
    projectId: string
    workflowId: string
    toolKey: string
}): Promise<ApprovalChoice | null> => {
    const response = await getApprovalChoicesClient().createApprovalChoice(
        {approval_choice: {workflow_id: workflowId, tool_key: toolKey}},
        projectScopedRequest(projectId),
    )
    const data = safeParseWithLogging(
        approvalChoiceResponseSchema,
        response,
        "[createApprovalChoice]",
    )
    return data?.approval_choice ?? null
}

/** The asker's own choices in the project. */
export const queryApprovalChoices = async ({
    projectId,
}: {
    projectId: string
}): Promise<ApprovalChoice[]> => {
    const response = await getApprovalChoicesClient().queryApprovalChoices(
        {},
        projectScopedRequest(projectId),
    )
    const data = safeParseWithLogging(
        approvalChoicesResponseSchema,
        response,
        "[queryApprovalChoices]",
    )
    return data?.approval_choices ?? []
}

export const deleteApprovalChoice = async ({
    projectId,
    approvalChoiceId,
}: {
    projectId: string
    approvalChoiceId: string
}): Promise<void> => {
    await getApprovalChoicesClient().deleteApprovalChoice(
        {approval_choice_id: approvalChoiceId},
        projectScopedRequest(projectId),
    )
}
