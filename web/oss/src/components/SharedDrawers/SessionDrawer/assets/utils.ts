const GENERATOR_REPR = /^<(?:async_)?generator object/

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
    if (inputs) {
        if (Array.isArray(inputs.messages)) {
            messages.push(...inputs.messages.map((m: any) => ({role: m.role, content: m.content})))
        } else if (Array.isArray(inputs.prompt)) {
            messages.push(...inputs.prompt.map((m: any) => ({role: m.role, content: m.content})))
        } else {
            const content = inputs.message || inputs.input || JSON.stringify(inputs)
            messages.push({
                role: "user",
                content: typeof content === "string" ? content : JSON.stringify(content),
            })
        }
    }

    // Handle Outputs
    if (outputs) {
        if (typeof outputs === "string") {
            // The agent span's output is the assistant's reply text — render it directly.
            messages.push({role: "assistant", content: outputs})
        } else if (Array.isArray(outputs.completion)) {
            messages.push(
                ...outputs.completion.map((m: any) => ({role: m.role, content: m.content})),
            )
        } else if (outputs.role && outputs.content) {
            messages.push({role: outputs.role, content: outputs.content})
        } else {
            const content = outputs.message || outputs.output || JSON.stringify(outputs)
            messages.push({
                role: "assistant",
                content: typeof content === "string" ? content : JSON.stringify(content),
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
