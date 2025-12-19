export const extractTraceData = (trace: any) => {
    const inputs = trace.inputs || trace.attributes?.ag?.data?.inputs
    const outputs = trace.outputs || trace.attributes?.ag?.data?.outputs

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
        if (Array.isArray(outputs.completion)) {
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

    return messages
}
