import type {UIMessage} from "ai"

/**
 * Tools with no external side effect — safe to rewind/retry past silently. v1 hardcodes
 * this; the principled source is a `readOnly` flag on the tool spec (see
 * `docs/design/agent-workflows/agent-chat-rewind.md`). Everything not listed here is treated
 * as potentially side-effecting, so the user is warned before rewinding past it.
 */
export const READ_ONLY_TOOLS = new Set(["search_docs"])

/** Concatenated text of a message's text parts. */
export const messageText = (message: UIMessage): string =>
    message.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as {text: string}).text)
        .join("")

/**
 * Names of side-effecting tools that ALREADY produced output within `messages` — i.e. real
 * actions a rewind cannot undo (e.g. a sent email). Read-only tools are ignored, and tool
 * calls that never ran (still awaiting approval, denied, errored) are ignored.
 */
export const sideEffectingToolsInRange = (messages: UIMessage[]): string[] => {
    const names = new Set<string>()
    for (const message of messages) {
        for (const part of message.parts) {
            if (!part.type.startsWith("tool-")) continue
            const ran = (part as {state?: string}).state === "output-available"
            const name = part.type.replace(/^tool-/, "")
            if (ran && !READ_ONLY_TOOLS.has(name)) names.add(name)
        }
    }
    return [...names]
}
