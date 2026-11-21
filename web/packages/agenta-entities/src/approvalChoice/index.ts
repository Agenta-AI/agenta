/**
 * `@agenta/entities/approvalChoice`: a person's "always approve" for one of the builder's tools,
 * which the server answers at the approval gate.
 */
export {approvalChoiceSchema, type ApprovalChoice} from "./schema"

export {createApprovalChoice, deleteApprovalChoice, queryApprovalChoices} from "./api"

export {approvalChoicesQueryAtom, invalidateApprovalChoices} from "./state"
