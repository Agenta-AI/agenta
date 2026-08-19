import {type UIMessage} from "ai"

/** A tool call: typed parts encode the name as `tool-<name>`, dynamic ones carry it on `toolName`. */
export const isToolPart = (p: UIMessage["parts"][number]): boolean =>
    p.type.startsWith("tool-") || p.type === "dynamic-tool"

/** A part the transcript renders: non-empty prose, files, sources, or tools. */
export const isVisiblePart = (p: UIMessage["parts"][number]): boolean =>
    (p.type === "text" && Boolean((p as {text?: string}).text?.trim())) ||
    (p.type === "reasoning" && Boolean((p as {text?: string}).text?.trim())) ||
    p.type === "file" ||
    p.type === "source-url" ||
    isToolPart(p)

/** A settled assistant turn with no content at all — no answer, reasoning, tool, file, or
 * source part. Mirrors AgentMessage's `!hasContent`; used to collapse a run of "no response"
 * bubbles (e.g. repeated failed runs) down to the first one. */
export const isEmptyAssistantTurn = (m: UIMessage): boolean =>
    m.role === "assistant" && !m.parts.some(isVisiblePart)

/** Assistant message id → its 1-based turn number (records/turns align 1:1 with the assistant
 * messages — one per `done`). Built once per message set: the per-message scan it replaces was
 * O(n) inside a render loop, so the transcript paid O(n²) on every streamed commit. */
export const assistantTurnNumbers = (messages: UIMessage[]): Map<string, number> => {
    const turns = new Map<string, number>()
    let n = 0
    for (const m of messages) {
        if (m.role === "assistant") {
            n += 1
            turns.set(m.id, n)
        }
    }
    return turns
}
