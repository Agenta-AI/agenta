import React, {useMemo} from "react"

import {CopyTooltip} from "@agenta/ui/copy-tooltip"
import {SharedEditor} from "@agenta/ui/shared-editor"
import clsx from "clsx"
import JSON5 from "json5"

interface ToolCallViewProps {
    resultData?: unknown
    className?: string
    action?: React.ReactNode
    footer?: React.ReactNode
}

interface Payload {
    name?: string
    callId?: string
    json: string
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null
}

function getStringField(record: UnknownRecord | undefined, key: string): string | undefined {
    if (!record) return undefined
    const value = record[key]
    return typeof value === "string" ? value : undefined
}

function getWrappedStringField(record: UnknownRecord | undefined, key: string): string | undefined {
    const direct = getStringField(record, key)
    if (direct) return direct
    const wrapped = record?.[key]
    if (isRecord(wrapped) && typeof wrapped.value === "string") {
        return wrapped.value
    }
    return undefined
}

interface GatewayToolParsed {
    provider: string
    integration: string
    action: string
    connection: string
}

// Parse gateway tool slug: tools__{provider}__{integration}__{action}__{connection}
// Segments may contain single underscores; only "__" is a separator.
function parseGatewayFunctionName(name: string | undefined): GatewayToolParsed | null {
    if (!name) return null
    const parts = name.split("__")
    if (parts.length !== 5 || parts[0] !== "tools") return null
    const [, provider, integration, action, connection] = parts
    if (!provider || !integration || !action || !connection) return null
    return {provider, integration, action, connection}
}

function formatGatewayToolLabel(name: string | undefined): string | undefined {
    const parsed = parseGatewayFunctionName(name)
    if (!parsed) return name
    return `${parsed.integration} / ${parsed.action} / ${parsed.connection}`
}

function getRecordField(record: UnknownRecord | undefined, key: string): UnknownRecord | undefined {
    if (!record) return undefined
    const value = record[key]
    return isRecord(value) ? value : undefined
}

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
    const displayName = formatGatewayToolLabel(name)
    return (
        <div className={clsx("w-full p-2 pt-0 flex items-center justify-between", className)}>
            <CopyTooltip title={"Function name"}>
                <span title={name}>{displayName}</span>
            </CopyTooltip>
            <CopyTooltip title={"Call id"}>
                <span className="font-mono">{callId}</span>
            </CopyTooltip>
        </div>
    )
}

function toArrayItemPayload(item: unknown, index: number): Payload {
    if (!isRecord(item)) {
        return {
            name: `tool_${index + 1}`,
            callId: undefined,
            json: toPrettyString({}),
        }
    }

    let fnName = ""
    let argsRaw: unknown = {}
    let callId =
        getWrappedStringField(item, "id") ??
        getWrappedStringField(item, "__id") ??
        getWrappedStringField(item, "tool_call_id") ??
        getWrappedStringField(item, "toolCallId") ??
        getWrappedStringField(item, "toolCallID")

    const functionRecord = getRecordField(item, "function")
    if (functionRecord) {
        fnName = getWrappedStringField(functionRecord, "name") ?? ""
        argsRaw = functionRecord.arguments ?? {}
    } else {
        const content = getStringField(item, "content")
        if (content) {
            const parsedContent = parseJsonLoose(content)
            if (isRecord(parsedContent)) {
                const parsedFunction = getRecordField(parsedContent, "function")
                fnName = getStringField(parsedFunction, "name") ?? ""
                argsRaw = parsedFunction?.arguments ?? {}
                callId =
                    callId ??
                    getWrappedStringField(parsedContent, "id") ??
                    getWrappedStringField(parsedContent, "__id") ??
                    getWrappedStringField(parsedContent, "tool_call_id") ??
                    getWrappedStringField(parsedContent, "toolCallId")
            }
        }
    }

    return {
        name: fnName || `tool_${index + 1}`,
        callId,
        json: toPrettyString(argsRaw),
    }
}

export const createToolCallPayloads = (resultData: unknown): Payload[] => {
    const raw = resultData
    if (!raw) return []

    if (Array.isArray(raw)) {
        return raw.map((item, index) => toArrayItemPayload(item, index))
    }

    const inner = isRecord(raw) ? (raw.data ?? raw) : raw
    const innerRecord = isRecord(inner) ? inner : undefined
    const toolCalls = innerRecord?.tool_calls

    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        return toolCalls.map((toolCall, index) => {
            if (!isRecord(toolCall)) {
                return {
                    name: `tool_${index + 1}`,
                    callId: undefined,
                    json: toPrettyString({}),
                }
            }

            const functionRecord = getRecordField(toolCall, "function")

            return {
                name:
                    getWrappedStringField(functionRecord, "name") ??
                    getWrappedStringField(toolCall, "name") ??
                    `tool_${index + 1}`,
                callId:
                    getWrappedStringField(toolCall, "id") ??
                    getWrappedStringField(toolCall, "__id") ??
                    getWrappedStringField(toolCall, "tool_call_id") ??
                    getWrappedStringField(toolCall, "toolCallId") ??
                    getWrappedStringField(toolCall, "toolCallID"),
                json: toPrettyString(functionRecord?.arguments ?? toolCall.arguments ?? {}),
            }
        })
    }

    const functionCall = getRecordField(innerRecord, "function_call")
    if (functionCall) {
        return [
            {
                name: getStringField(functionCall, "name") || "function",
                callId: undefined,
                json: toPrettyString(functionCall.arguments ?? {}),
            },
        ]
    }

    return []
}

const ToolCallView: React.FC<ToolCallViewProps> = ({resultData, className, footer}) => {
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
