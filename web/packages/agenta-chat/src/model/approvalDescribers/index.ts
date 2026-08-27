/**
 * Built-in approval describers, shipped by the package so every host renders the same plain-language
 * card without registering anything. Resolved as a VALUE fallback (see `describeApproval`), never as
 * an import-time side effect — a `sideEffects: false` boundary would tree-shake side-effect
 * registration away, exactly the hazard the client-tool registry documents.
 */
import type {ApprovalDescriber} from "../../skin/types"

import {describeCommitRevision} from "./describeCommitRevision"

export {describeCommitRevision}
export {parseApprovedContentManifest} from "./approvedContentManifest"
export type {ApprovedContentManifestValue} from "./approvedContentManifest"
export {
    operationLabel,
    parseRevisionOperations,
    readableTarget,
    type RevisionOperationPreview,
} from "./operationsPreview"

/** Keyed by the CANONICAL tool name (`describeApproval` canonicalizes before lookup). */
export const BUILTIN_APPROVAL_DESCRIBERS: Record<string, ApprovalDescriber> = {
    commit_revision: describeCommitRevision,
}
