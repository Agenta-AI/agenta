/**
 * Approval renderer registry.
 *
 * Per-tool friendly bodies for the HITL ApprovalDock, used in both Chat and Build mode (Build
 * gets the compact one-column shape). The store lives in @agenta/chat/skin; this module registers
 * the desktop bodies at import time and re-exports the resolver under the old name. Tools
 * without an entry (or whose Body can't preview its payload) keep the generic raw-payload
 * card, so nothing here is load-bearing for unknown tools.
 */
import {registerChatSkin, resolveApprovalBody} from "@agenta/chat/skin"
import type {ApprovalBodyEntry, ApprovalBodyProps as SkinApprovalBodyProps} from "@agenta/chat/skin"

import CommitRevisionApproval from "./CommitRevisionApproval"

export type ApprovalBodyProps = SkinApprovalBodyProps
export type ApprovalRenderer = ApprovalBodyEntry

registerChatSkin({
    approvals: {
        commit_revision: {
            Body: CommitRevisionApproval,
            headline: null,
            approveLabel: "Approve & commit",
        },
    },
})

/** Resolve the renderer for an approval, or `null` for the generic card. */
export const resolveApprovalRenderer = (toolName: string): ApprovalRenderer | null =>
    resolveApprovalBody(toolName) ?? null
