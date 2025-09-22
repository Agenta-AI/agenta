import {useMemo} from "react"

import {getTextContent} from "../../adapters/TurnMessageHeaderOptions"

export const useAssistantDisplayValue = (assistantMsg: any, result: any) => {
    return useMemo(() => {
        const direct = assistantMsg?.content?.value
        if (Array.isArray(direct)) return getTextContent(direct)
        if (typeof direct === "string" && direct.length > 0) return direct
        if (direct && typeof direct === "object" && "value" in (direct as any)) {
            const v = (direct as any).value
            if (Array.isArray(v)) return getTextContent(v)
            if (typeof v === "string") return v
        }

        const raw = (result as any)?.response?.data
        if (raw !== undefined && raw !== null) {
            if (typeof raw === "string") return raw
            if (typeof raw === "object") {
                const inner = (raw as any)?.data ?? raw
                const content = (inner as any).content ?? (inner as any).data
                if (typeof content === "string") return content
                if (Array.isArray(content)) return getTextContent(content)
                if (content && typeof content === "object" && "value" in content) {
                    return String((content as any).value ?? "")
                }

                const toolCalls = (inner as any).tool_calls
                const functionCall = (inner as any).function_call
                try {
                    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                        if (toolCalls.length === 1) {
                            const tc = toolCalls[0]
                            const name = tc?.function?.name || tc?.name || `tool_1`
                            const argsRaw = tc?.function?.arguments || tc?.arguments || {}
                            const argsStr =
                                typeof argsRaw === "string"
                                    ? argsRaw
                                    : (() => {
                                          try {
                                              return JSON.stringify(argsRaw, null, 2)
                                          } catch {
                                              return String(argsRaw ?? "")
                                          }
                                      })()
                            return `Tool call: ${name} \n${argsStr}`
                        }
                        try {
                            return JSON.stringify(toolCalls, null, 2)
                        } catch {
                            return String(toolCalls)
                        }
                    }
                    if (functionCall && typeof functionCall === "object") {
                        const name = (functionCall as any).name || "function"
                        const args = (functionCall as any).arguments || {}
                        const argsStr =
                            typeof args === "string" ? args : JSON.stringify(args, null, 2)
                        return `Function call: ${name} \n${argsStr}`
                    }
                } catch {
                    // ignore
                }
            }
            try {
                return JSON.stringify(raw)
            } catch {
                return String(raw ?? "")
            }
        }
        return undefined
    }, [assistantMsg?.content?.value, result])
}

export const useToolCallsView = (result: any) => {
    return useMemo(() => {
        const raw = (result as any)?.response?.data
        if (!raw) return undefined
        const inner = typeof raw === "object" ? ((raw as any).data ?? raw) : raw
        const toolCalls = (inner as any)?.tool_calls
        const functionCall = (inner as any)?.function_call

        try {
            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                if (toolCalls.length === 1) {
                    const tc = toolCalls[0]
                    const name = tc?.function?.name || tc?.name || `tool_1`
                    const argsRaw = tc?.function?.arguments || tc?.arguments || {}
                    const argsStr = (() => {
                        if (typeof argsRaw === "string") {
                            try {
                                const parsed = JSON.parse(argsRaw)
                                return JSON.stringify(parsed, null, 2)
                            } catch {
                                return argsRaw
                            }
                        }
                        try {
                            return JSON.stringify(argsRaw, null, 2)
                        } catch {
                            return String(argsRaw ?? "")
                        }
                    })()
                    return {title: `Tool call: ${name}`, json: argsStr}
                }
                return {title: undefined, json: JSON.stringify(toolCalls, null, 2)}
            }
            if (functionCall && typeof functionCall === "object") {
                const name = (functionCall as any).name || "function"
                const args = (functionCall as any).arguments || {}
                const argsStr = (() => {
                    if (typeof args === "string") {
                        try {
                            const parsed = JSON.parse(args)
                            return JSON.stringify(parsed, null, 2)
                        } catch {
                            return args
                        }
                    }
                    try {
                        return JSON.stringify(args, null, 2)
                    } catch {
                        return String(args ?? "")
                    }
                })()
                return {title: `Function call: ${name}`, json: argsStr}
            }
        } catch {
            // ignore
        }
        return undefined
    }, [result])
}

export default useAssistantDisplayValue
