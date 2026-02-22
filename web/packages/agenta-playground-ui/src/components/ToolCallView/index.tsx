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
    return (
        <div className={clsx("w-full p-2 pt-0 flex items-center justify-between", className)}>
            <CopyTooltip title={"Function name"}>
                <span>{name}</span>
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
    let callId = getStringField(item, "id") ?? getStringField(item, "__id")

    const functionRecord = getRecordField(item, "function")
    if (functionRecord) {
        fnName = getStringField(functionRecord, "name") ?? ""
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
                    getStringField(parsedContent, "id") ??
                    getStringField(parsedContent, "__id")
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
                    getStringField(functionRecord, "name") ??
                    getStringField(toolCall, "name") ??
                    `tool_${index + 1}`,
                callId: getStringField(toolCall, "id") ?? getStringField(toolCall, "__id"),
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
