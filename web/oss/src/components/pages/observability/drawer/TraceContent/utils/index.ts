export const transformDataInputs = (data: any) => {
    return Object.keys(data).reduce((acc, curr) => {
        if (curr === "prompt") {
            acc[curr] = data[curr]
        }

        if (!acc.tools) {
            acc.tools = []
        }

        if (curr === "functions") {
            const functions = data[curr].map((item: any) => ({
                type: "function",
                function: item,
            }))
            acc.tools.push(...functions)
        }

        if (curr === "tools") {
            acc.tools.push(...data[curr])
        }

        return acc
    }, {} as any)
}
