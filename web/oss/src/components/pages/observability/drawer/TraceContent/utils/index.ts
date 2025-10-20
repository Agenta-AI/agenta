export const transformDataInputs = (data: any) => {
    if (!data) {
        return {}
    }

    const transformed: Record<string, any> = {}

    if (data.prompt) {
        transformed.prompt = data.prompt
    }

    const tools: any[] = []

    if (Array.isArray(data.functions)) {
        const functions = data.functions.map((item: any) => ({
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
