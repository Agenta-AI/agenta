import {inferLogicalType} from "@agenta/shared/utils"

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
        let allStringsMarkdown = true

        for (const row of rows) {
            const v = row[key]
            if (v === undefined) continue
            sawAnyValue = true

            // Use native type inference only. Strings that contain JSON remain
            // strings; explicit decode flows are responsible for parsing.
            const nextType = inferLogicalType(v) as ColumnTypePrimitive
            let nextHint: ColumnRenderHint | null = null

            if (nextType === "json-array") {
                if (Array.isArray(v) && isMessagesArray(v)) nextHint = "messages"
                else if (Array.isArray(v) && isToolCallsArray(v)) nextHint = "tool-calls"
            } else if (nextType === "string" && typeof v === "string") {
                sawAnyString = true
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
                if (allStringsMarkdown) observedHint = "markdown"
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
