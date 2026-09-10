import type {ToolUIPart, UIMessage} from "ai"

import {isToolPart, partToolName} from "./parts"

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/ApprovalDock.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes.
export interface PendingApproval {
    approvalId: string
    toolName: string
    input: unknown
    /** Workspace content the runner resolved and froze for this gate, when the call imports any. */
    manifest?: unknown
}

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/ApprovalDock.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes.
interface ApprovalRef {
    id: string
}

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/ApprovalDock.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes.
/** Manifests keyed by toolCallId, from the egress's `data-approval-manifest` sibling parts. */
const manifestsByToolCallId = (parts: UIMessage["parts"] = []): Map<string, unknown> => {
    const found = new Map<string, unknown>()
    for (const part of parts) {
        if ((part as {type?: string}).type !== "data-approval-manifest") continue
        const data = (part as {data?: Record<string, unknown>}).data
        const toolCallId = data?.toolCallId
        if (typeof toolCallId === "string" && data?.manifest !== undefined) {
            found.set(toolCallId, data.manifest)
        }
    }
    return found
}

/**
 * Pending approval gates across assistant messages, in transcript order.
 *
 * #5919 widened this from "the LAST assistant turn" to the whole transcript: a card parked several
 * turns up still holds the gate. The manifest lookup is per-message — the `data-approval-manifest`
 * parts are siblings of the tool call they describe, so they must be read from the same message.
 */
export const getPendingApprovals = (messages: UIMessage[]): PendingApproval[] => {
    const out: PendingApproval[] = []
    for (const message of messages) {
        if (message.role !== "assistant") continue
        const continuation = (
            message.metadata as
                | {
                      approvalContinuation?: {
                          state?: string
                          approvalIds?: unknown
                      }
                  }
                | undefined
        )?.approvalContinuation
        const terminalApprovalIds =
            (continuation?.state === "done" || continuation?.state === "error") &&
            Array.isArray(continuation.approvalIds)
                ? new Set(
                      continuation.approvalIds.filter(
                          (id): id is string => typeof id === "string" && id.length > 0,
                      ),
                  )
                : null
        const manifests = manifestsByToolCallId(message.parts)
        for (const part of message.parts ?? []) {
            const p = part as ToolUIPart
            const approval = (p as {approval?: ApprovalRef}).approval
            if (
                isToolPart(p.type as string) &&
                p.state === "approval-requested" &&
                approval?.id &&
                !terminalApprovalIds?.has(approval.id)
            ) {
                out.push({
                    approvalId: approval.id,
                    toolName: partToolName(p),
                    input: p.input,
                    manifest: manifests.get(p.toolCallId),
                })
            }
        }
    }
    return out
}

/** Stopped turns expose no actionable approval gates. */
export const getLivePendingApprovals = (
    messages: UIMessage[],
    options?: {stopped?: boolean},
): PendingApproval[] => (options?.stopped ? [] : getPendingApprovals(messages))
