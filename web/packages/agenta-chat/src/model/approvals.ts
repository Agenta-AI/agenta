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
        const manifests = manifestsByToolCallId(message.parts)
        for (const part of message.parts ?? []) {
            const p = part as ToolUIPart
            const approval = (p as {approval?: ApprovalRef}).approval
            if (isToolPart(p.type as string) && p.state === "approval-requested" && approval?.id) {
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

/**
 * The pending gates a LIVE transcript may still act on. Empty once the user stopped the turn.
 *
 * Stop cancels the stopped turn's interactions server-side (the cancel branch of
 * `POST /sessions/streams/`), so an approve or deny pressed after a Stop answers a turn that no
 * longer exists — #6315, "a stopped session keeps an approval card whose buttons do nothing".
 * Replay already reaches the same conclusion from the stored rows (`settleApprovalPart` maps a
 * `cancelled` interaction to `output-denied`); this is the live path reaching it without waiting
 * for a refetch, and it is why the rule lives beside `getPendingApprovals` rather than in one
 * client: the desktop and the mobile chat must not disagree about it.
 */
export const getLivePendingApprovals = (
    messages: UIMessage[],
    options?: {stopped?: boolean},
): PendingApproval[] => (options?.stopped ? [] : getPendingApprovals(messages))
