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

export const stripNestedSpans = <T>(value: T): T => {
    if (Array.isArray(value)) {
        return value.map((item) => stripNestedSpans(item)) as T
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([key]) => !["spans", "children", "nodes"].includes(key))
                .map(([key, nestedValue]) => [key, stripNestedSpans(nestedValue)]),
        ) as T
    }

    return value
}
