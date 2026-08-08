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
 * Approvals the run is currently blocked on. HITL only ever pauses the LAST assistant turn (see
 * `isHitlPending`), so we read pending tool gates off that turn — a turn can request several at
 * once (parallel tool calls), so this returns all of them in order.
 */
export const getPendingApprovals = (messages: UIMessage[]): PendingApproval[] => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") return []
    const out: PendingApproval[] = []
    const manifests = manifestsByToolCallId(last.parts)
    for (const part of last.parts ?? []) {
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
    return out
}
