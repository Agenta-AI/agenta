import type {ToolUIPart, UIMessage} from "ai"

import {isToolPart, partToolName} from "./parts"

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/ApprovalDock.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes.
export interface PendingApproval {
    approvalId: string
    toolName: string
    input: unknown
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
/** Pending approval gates across assistant messages, in transcript order. */
export const getPendingApprovals = (messages: UIMessage[]): PendingApproval[] => {
    const out: PendingApproval[] = []
    for (const message of messages) {
        if (message.role !== "assistant") continue
        for (const part of message.parts ?? []) {
            const p = part as ToolUIPart
            const approval = (p as {approval?: ApprovalRef}).approval
            if (isToolPart(p.type as string) && p.state === "approval-requested" && approval?.id) {
                out.push({approvalId: approval.id, toolName: partToolName(p), input: p.input})
            }
        }
    }
    return out
}
