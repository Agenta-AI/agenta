import type {ToolUIPart, UIMessage} from "ai"

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the
// re-plumb PR deletes it. Keep byte-parity if either side changes.
export const isToolPart = (type: string) => type.startsWith("tool-") || type === "dynamic-tool"

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the
// re-plumb PR deletes it. Keep byte-parity if either side changes.
/** Dedup key for a tool call. Stringifies its input, which can be large — call it sparingly. */
export const toolIdentity = (p: ToolUIPart): string => {
    let inputKey = ""
    try {
        inputKey = JSON.stringify((p as {input?: unknown}).input ?? null)
    } catch {
        inputKey = ""
    }
    return `${p.type}::${inputKey}`
}

// Copied verbatim from web/oss/src/components/AgentChatSlice/AgentConversation.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the
// re-plumb PR deletes it. Keep byte-parity if either side changes.
/** A part the transcript actually renders — non-empty text/reasoning, files, sources, tools. */
export const isVisiblePart = (p: UIMessage["parts"][number]): boolean =>
    (p.type === "text" && Boolean((p as {text?: string}).text?.trim())) ||
    (p.type === "reasoning" && Boolean((p as {text?: string}).text?.trim())) ||
    p.type === "file" ||
    p.type === "source-url" ||
    p.type.startsWith("tool-") ||
    p.type === "dynamic-tool"

// Copied verbatim from web/oss/src/components/AgentChatSlice/AgentConversation.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the
// re-plumb PR deletes it. Keep byte-parity if either side changes.
/** A settled assistant turn with no content at all — no answer, reasoning, tool, file, or
 * source part. Mirrors AgentMessage's `!hasContent`; used to collapse a run of "no response"
 * bubbles (e.g. repeated failed runs) down to the first one. */
export const isEmptyAssistantTurn = (m: UIMessage): boolean =>
    m.role === "assistant" && !m.parts.some(isVisiblePart)

// Copied verbatim from web/oss/src/components/AgentChatSlice/assets/toolDisplay.ts
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the
// re-plumb PR deletes it. Keep byte-parity if either side changes.
/** Wire name of a tool part. `dynamic-tool` carries it on `toolName`; typed parts encode it as
 * `tool-<name>`. */
export const partToolName = (part: ToolUIPart): string => {
    // `dynamic-tool` parts reach here via the grouping cast in AgentMessage but sit outside
    // ToolUIPart's static union — read `type` as a string.
    const type = part.type as string
    if (type === "dynamic-tool") {
        return (part as {toolName?: string}).toolName || "tool"
    }
    return type.replace(/^tool-/, "")
}
