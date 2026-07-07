/**
 * Approval renderer registry.
 *
 * Per-tool friendly bodies for the HITL ApprovalDock, used in Chat mode only (Build always
 * shows the exact-payload card). Same dispatch idea as the client-tool registry, keyed by the
 * approval's tool name. An entry supplies a Body plus optional copy overrides; tools without an
 * entry (or whose Body can't preview its payload) keep the generic raw-payload card, so nothing
 * here is load-bearing for unknown tools.
 */
import type {ComponentType, ReactNode} from "react"

import CommitRevisionApproval from "./CommitRevisionApproval"

export interface ApprovalBodyProps {
    /** The exact tool input the user is approving. */
    input: unknown
    /** Selected agent revision — specialized bodies diff payloads against its committed config. */
    entityId: string
    /** The dock's generic payload block — render it verbatim when the payload can't be previewed. */
    fallback: ReactNode
}

export interface ApprovalRenderer {
    Body: ComponentType<ApprovalBodyProps>
    /** Replaces "The agent wants to run this tool before it can keep going."; null = Body owns it. */
    headline?: string | null
    approveLabel?: string
}

const BY_TOOL_NAME: Record<string, ApprovalRenderer> = {
    commit_revision: {
        Body: CommitRevisionApproval,
        headline: null,
        approveLabel: "Approve & commit",
    },
}

/** Resolve the renderer for an approval, or `null` for the generic card. */
export const resolveApprovalRenderer = (toolName: string): ApprovalRenderer | null =>
    BY_TOOL_NAME[toolName] ?? null
