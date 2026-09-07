import type {FileUIPart, ToolUIPart, UIMessage} from "ai"

import {isToolPart, toolIdentity} from "./parts"

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes.
// Tools can be interleaved with text / reasoning, so fold only *consecutive* tool parts
// into one ToolActivity group (a run of calls reads as a single "Used N tools" line).
export type RenderItem =
    | {kind: "part"; part: UIMessage["parts"][number]; index: number}
    | {kind: "tools"; parts: ToolUIPart[]; index: number}
    | {kind: "clientTool"; part: ToolUIPart; index: number}
    | {kind: "files"; parts: FileUIPart[]; index: number}

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes. Adapted only to take `parts` as a
// parameter instead of reading them off `useMemo`'s closure.
// Dedup set of executed tool calls (by input identity), memoized on a cheap tool-parts signature
// (id + state) that stays STABLE while text streams — so the tool-input JSON.stringify doesn't
// re-run on every streamed token of a tool-heavy turn. Hoisted above the early returns below to
// keep hook order stable.
export const executedToolIdentities = (parts: UIMessage["parts"]): Set<string> =>
    new Set(
        parts
            .filter(
                (p) =>
                    isToolPart(p.type) &&
                    ((p as ToolUIPart).state === "output-available" ||
                        (p as ToolUIPart).state === "output-error"),
            )
            .map((p) => toolIdentity(p as ToolUIPart)),
    )

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes. Adapted only to take the executed set
// as a parameter instead of closing over it.
// A HITL-approved tool's part LINGERS in `approval-responded` (a perpetual spinner, no output):
// the cold-replay runner re-issues the approved call under a FRESH id, so its execution output
// lands on a SEPARATE sibling part. Drop the answered gate once its executed sibling exists (same
// tool + same input), so the turn shows the single completed call with its output — not a stuck
// spinner beside a duplicate. Until the execution settles, the gate stays (it is genuinely
// in-flight).
export const isSupersededGate = (part: ToolUIPart, executed: Set<string>): boolean =>
    part.state === "approval-responded" && executed.has(toolIdentity(part))

export interface BuildTurnRenderItemsOptions {
    executed: Set<string>
    /** Registry-backed check; the desktop closes over {isStreaming, isLastMessage} + renderMap — see AgentMessage.tsx. */
    isClientToolPart: (part: ToolUIPart) => boolean
}

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes. Adapted to take `parts` and the
// registry-backed client-tool predicate as parameters, so this layer stays registry-free.
export const buildTurnRenderItems = (
    parts: UIMessage["parts"],
    {executed, isClientToolPart}: BuildTurnRenderItemsOptions,
): RenderItem[] => {
    const renderItems: RenderItem[] = []
    parts.forEach((part, i) => {
        if (isToolPart(part.type)) {
            // The answered gate whose execution already landed on a sibling part — drop it so the
            // turn doesn't show a stuck approval spinner beside the real, completed call.
            if (isSupersededGate(part as ToolUIPart, executed)) return
            // A browser-fulfilled client tool (#4920) renders as its own widget/chip, NOT folded
            // into the "Used N tools" group — so it breaks any current tool run.
            if (isClientToolPart(part as ToolUIPart)) {
                renderItems.push({kind: "clientTool", part: part as ToolUIPart, index: i})
                return
            }
            const last = renderItems[renderItems.length - 1]
            if (last && last.kind === "tools") last.parts.push(part as ToolUIPart)
            else renderItems.push({kind: "tools", parts: [part as ToolUIPart], index: i})
            return
        }
        // Consecutive attachments share one grid, so a message's files lay out as a block
        // instead of one full-width card per part.
        if (part.type === "file") {
            const last = renderItems[renderItems.length - 1]
            if (last && last.kind === "files") last.parts.push(part as FileUIPart)
            else renderItems.push({kind: "files", parts: [part as FileUIPart], index: i})
            return
        }
        renderItems.push({kind: "part", part, index: i})
    })
    return renderItems
}
