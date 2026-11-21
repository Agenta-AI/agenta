/**
 * Approval choices: a person's "always approve" for one of the builder's tools.
 *
 * Wire shapes of `/approval-choices` (design D32 of the session communication change).
 */
import {z} from "zod"

export const approvalChoiceSchema = z.object({
    id: z.string(),
    workflow_id: z.string(),
    tool_key: z.string(),
    created_at: z.string().nullish(),
})

export const approvalChoicesResponseSchema = z.object({
    count: z.number(),
    approval_choices: z.array(approvalChoiceSchema),
})

export const approvalChoiceResponseSchema = z.object({
    count: z.number(),
    approval_choice: approvalChoiceSchema.nullish(),
})

export type ApprovalChoice = z.infer<typeof approvalChoiceSchema>
