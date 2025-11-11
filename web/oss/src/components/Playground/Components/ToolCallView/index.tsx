import React, {useMemo} from "react"

import clsx from "clsx"
import JSON5 from "json5"

import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"

interface ToolCallViewProps {
    // Raw result.response.data from worker or API
    resultData?: any
    className?: string
    // Optional CTA near the title (e.g., Send); caller can render their own if needed
    action?: React.ReactNode
    // Optional footer to render inside SharedEditor (e.g., GenerationResultUtils)
    footer?: React.ReactNode
}

interface Payload {
    name?: string
    callId?: string
    json: string
}

// Try JSON.parse first, then fall back to JSON5; if both fail, return the original string
function parseJsonLoose(input: string): unknown {
    try {
        return JSON.parse(input)
    } catch {
        try {
            return JSON5.parse(input)
        } catch {
            return input
        }
    }
}

// Convert arbitrary value to a pretty JSON string when possible
function toPrettyString(value: unknown): string {
    if (typeof value === "string") {
        const parsed = parseJsonLoose(value)
        if (typeof parsed === "string") return parsed
        try {
            return JSON.stringify(parsed, null, 2)
        } catch {
            return String(parsed)
        }
    }
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value ?? "")
    }
}

export const ToolCallViewHeader = ({
    name,
    callId,
    className,
}: {
    name?: string
    callId?: string
    className?: string
}) => {
    return (
        <div className={clsx("w-full p-2 pt-0 flex items-center justify-between", className)}>
            <TooltipWithCopyAction title={"Function name"}>
                <span>{name}</span>
            </TooltipWithCopyAction>
            <TooltipWithCopyAction title={"Call id"}>
                <span>{callId}</span>
            </TooltipWithCopyAction>
        </div>
    )
}

export const createToolCallPayloads = (resultData: any) => {
    const raw = resultData
    if (!raw) return [] as Payload[]
    // Handle completion responses shaped as an array of function/tool messages
    if (Array.isArray(raw)) {
        const toPayload = (item: any): Payload => {
            let fnName: string | undefined
            let argsRaw: any = {}
            let callId: string | undefined
            if (item && typeof item === "object") {
                if ((item as any).function) {
                    fnName = (item as any).function?.name
                    argsRaw = (item as any).function?.arguments
                    callId = (item as any).id || (item as any).__id
                } else if (typeof (item as any).content === "string") {
                    try {
                        const parsed = JSON5.parse((item as any).content)
                        fnName = parsed?.function?.name
                        argsRaw = parsed?.function?.arguments
                        callId = parsed?.id || parsed?.__id
                    } catch {
                        // ignore
                    }
                }
            }
            const name = fnName || "tool_1"
            const argsStr = toPrettyString(argsRaw)
            return {name, callId, json: argsStr}
        }
        return raw.map(toPayload)
    }
    const inner = typeof raw === "object" ? ((raw as any).data ?? raw) : raw
    const toolCalls = (inner as any)?.tool_calls
    const functionCall = (inner as any)?.function_call
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        return toolCalls.map((tc: any) => ({
            name: tc?.function?.name || tc?.name || `tool_1`,
            callId: tc?.id || tc?.__id,
            json: toPrettyString(tc?.function?.arguments || tc?.arguments || {}),
        }))
    }
    if (functionCall && typeof functionCall === "object") {
        const name = (functionCall as any).name || "function"
        const args = (functionCall as any).arguments || {}
        const argsStr = toPrettyString(args)
        return [{name, callId: undefined, json: argsStr}]
    }
    return [] as Payload[]
}

const ToolCallView: React.FC<ToolCallViewProps> = ({resultData, className, action, footer}) => {
    const payloads = useMemo(() => {
        return createToolCallPayloads(resultData)
    }, [resultData])

    if (!payloads || payloads.length === 0) return null

    return (
        <div className={className}>
            {payloads.map((p, idx) => (
                <div key={idx} className={idx > 0 ? "mt-3" : undefined}>
                    <SharedEditor
                        initialValue={p.json}
                        editorType="borderless"
                        readOnly
                        disabled
                        editorProps={{codeOnly: true}}
                        header={<ToolCallViewHeader name={p.name} callId={p.callId} />}
                        footer={idx === payloads.length - 1 ? footer : undefined}
                    />
                </div>
            ))}
        </div>
    )
}

export default ToolCallView
