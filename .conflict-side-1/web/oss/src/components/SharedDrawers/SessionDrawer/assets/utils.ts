const GENERATOR_REPR = /^<(?:async_)?generator object/

const normalizeMessageContent = (content: unknown): string => {
    if (content === null || content === undefined) return ""
    if (typeof content === "string") return content

    try {
        const serialized = JSON.stringify(content)
        return serialized === undefined ? String(content) : serialized
    } catch {
        return String(content)
    }
}

const normalizeMessages = (messages: any[]): {role: string; content: string}[] =>
    messages.map((message) => ({
        role: message.role,
        content: normalizeMessageContent(message.content),
    }))

/**
 * A streamed agent run's ROOT span returns a generator, so its `outputs` is the generator
 * object's repr (`<async_generator object ... at 0x...>`), not the reply — the span is closed
 * before the stream produces text. The real assistant output lives on the nested `agent`-type
 * span (`invoke_agent`). Prefer that; fall back to the root's unless it's the generator repr.
 */
const agentRunOutputs = (trace: any): any => {
    let found: any
    const visit = (node: any) => {
        if (found !== undefined || !node) return
        if (node.span_type === "agent") {
            const out = node.outputs ?? node.attributes?.ag?.data?.outputs
            if (out !== undefined) found = out
        }
        ;(node.children ?? []).forEach(visit)
    }
    visit(trace)
    if (found !== undefined) return found

    const rootOut = trace.outputs || trace.attributes?.ag?.data?.outputs
    return typeof rootOut === "string" && GENERATOR_REPR.test(rootOut) ? undefined : rootOut
}

export const extractTraceData = (trace: any) => {
    const inputs = trace.inputs || trace.attributes?.ag?.data?.inputs
    const outputs = agentRunOutputs(trace)

    const messages: {role: string; content: string}[] = []

    // Handle Inputs
    if (inputs !== null && inputs !== undefined) {
        if (Array.isArray(inputs.messages)) {
            messages.push(...normalizeMessages(inputs.messages))
        } else if (Array.isArray(inputs.prompt)) {
            messages.push(...normalizeMessages(inputs.prompt))
        } else {
            const content = inputs.message ?? inputs.input ?? inputs
            messages.push({
                role: "user",
                content: normalizeMessageContent(content),
            })
        }
    }

    // Handle Outputs
    if (outputs !== null && outputs !== undefined) {
        if (typeof outputs === "string") {
            // The agent span's output is the assistant's reply text — render it directly.
            messages.push({role: "assistant", content: outputs})
        } else if (Array.isArray(outputs.completion)) {
            messages.push(...normalizeMessages(outputs.completion))
        } else if (outputs.role && outputs.content !== undefined) {
            messages.push({
                role: outputs.role,
                content: normalizeMessageContent(outputs.content),
            })
        } else {
            const content = outputs.message ?? outputs.output ?? outputs
            messages.push({
                role: "assistant",
                content: normalizeMessageContent(content),
            })
        }
    }

    // Handle Exception
    if (trace.status_code === "STATUS_CODE_ERROR") {
        messages.push({
            role: "exception",
            content: trace.status_message || "An error occurred during the session execution.",
        })
    }

    return messages
}
