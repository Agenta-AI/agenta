interface RawDataInputs {
    prompt?: unknown
    functions?: unknown[]
    tools?: unknown[]
    [key: string]: unknown
}

export const transformDataInputs = (data: RawDataInputs | null | undefined) => {
    if (!data) {
        return {}
    }

    const transformed: Record<string, unknown> = {}

    if (data.prompt) {
        transformed.prompt = data.prompt
    }

    const tools: unknown[] = []

    if (Array.isArray(data.functions)) {
        const functions = data.functions.map((item: unknown) => ({
            type: "function",
            function: item,
        }))

        tools.push(...functions)
    }

    if (Array.isArray(data.tools)) {
        tools.push(...data.tools)
    }

    if (tools.length > 0) {
        transformed.tools = tools
    }

    return transformed
}
