import {inferLogicalType, tryParseJson} from "@agenta/shared/utils"

import type {TypePrimitive, RenderHint} from "../../type-chip/TypeChip"

export type ColumnTypePrimitive = TypePrimitive
export type ColumnRenderHint = RenderHint

export interface ColumnTypeInfo {
    type: ColumnTypePrimitive
    hint: ColumnRenderHint | null
}

function isMessagesArray(arr: unknown[]): boolean {
    return (
        arr.length > 0 &&
        arr.every(
            (item) =>
                item != null &&
                typeof item === "object" &&
                "role" in (item as object) &&
                ("content" in (item as object) || "tool_calls" in (item as object)),
        )
    )
}

const TOOL_CALL_KEYS = new Set(["id", "type", "function"])

function isToolCallsArray(arr: unknown[]): boolean {
    return (
        arr.length > 0 &&
        arr.every(
            (item) =>
                item != null &&
                typeof item === "object" &&
                Object.keys(item as object).every((k) => TOOL_CALL_KEYS.has(k)) &&
                (item as {type?: unknown}).type === "function",
        )
    )
}

function isStringifiedJson(s: string): boolean {
    if (s.length < 2 || (s[0] !== "{" && s[0] !== "[")) return false
    return tryParseJson(s) !== null
}

function isMarkdownString(s: string): boolean {
    return s.length > 100 || s.includes("\n")
}

export function detectColumnTypes(
    rows: Record<string, unknown>[],
    columnKeys: string[],
): Map<string, ColumnTypeInfo> {
    const result = new Map<string, ColumnTypeInfo>()

    for (const key of columnKeys) {
        let observedType: ColumnTypePrimitive | null = null
        let observedHint: ColumnRenderHint | null = null
        let sawAnyValue = false
        let sawAnyString = false
        let allStringsStringified = true
        let allStringsMarkdown = true

        for (const row of rows) {
            const v = row[key]
            if (v === undefined) continue
            sawAnyValue = true

            // Use the shared logical-type inference so stringified primitives
            // ("42", "true", "null") and stringified objects/arrays surface as
            // their underlying type, matching the chip and renderer dispatch.
            const nextType = inferLogicalType(v) as ColumnTypePrimitive
            let nextHint: ColumnRenderHint | null = null

            if (nextType === "json-array") {
                const arr = Array.isArray(v) ? v : (tryParseJson<unknown[]>(v as string) ?? [])
                if (isMessagesArray(arr)) nextHint = "messages"
                else if (isToolCallsArray(arr)) nextHint = "tool-calls"
            } else if (nextType === "string" && typeof v === "string") {
                sawAnyString = true
                if (!isStringifiedJson(v)) allStringsStringified = false
                if (!isMarkdownString(v)) allStringsMarkdown = false
            }

            if (observedType === null) {
                observedType = nextType
                observedHint = nextHint
            } else if (observedType === "null" && nextType !== "null") {
                observedType = nextType
                observedHint = nextHint
            } else if (observedType !== nextType && nextType !== "null") {
                observedType = null
                break
            } else if (observedHint !== nextHint && nextType !== "null") {
                observedHint = null
            }
        }

        if (sawAnyValue && observedType !== null) {
            if (observedType === "string" && sawAnyString) {
                if (allStringsStringified) observedHint = "stringified"
                else if (allStringsMarkdown) observedHint = "markdown"
            }
            result.set(key, {type: observedType, hint: observedHint})
        }
    }

    return result
}

export function defaultHeaderVariant(
    _colKey: string,
    typeInfo: ColumnTypeInfo | undefined,
): ColumnTypePrimitive | undefined {
    return typeInfo?.type
}
