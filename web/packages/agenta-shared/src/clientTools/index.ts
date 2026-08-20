export const CLIENT_TOOL_DESCRIPTORS = {
    connection: {toolName: "request_connection", renderKind: "connect"},
    elicitation: {toolName: "request_input", renderKind: "elicitation"},
} as const

export const CLIENT_TOOL_NAMES: ReadonlySet<string> = new Set(
    Object.values(CLIENT_TOOL_DESCRIPTORS).map(({toolName}) => toolName),
)

const CLIENT_TOOL_INTERACTION_ENDED_KEY = "agenta_interaction_ended"

// Marks a terminal row with no saved answer, which is neither an answer nor an abandonment.
// Frozen: replay assigns it as a part's `output`, so a mutable singleton would alias every card.
export const CLIENT_TOOL_INTERACTION_ENDED_OUTPUT = Object.freeze({
    [CLIENT_TOOL_INTERACTION_ENDED_KEY]: true,
})

export function isInteractionEndedOutput(output: unknown): boolean {
    return (
        typeof output === "object" &&
        output !== null &&
        !Array.isArray(output) &&
        (output as Record<string, unknown>)[CLIENT_TOOL_INTERACTION_ENDED_KEY] === true
    )
}
