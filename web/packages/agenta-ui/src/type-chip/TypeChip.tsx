import {memo, type CSSProperties} from "react"

import {inferLogicalType, type LogicalType} from "@agenta/shared/utils"

export type TypePrimitive = LogicalType

export type RenderHint = "markdown" | "messages" | "tool-calls"

export type StateChip =
    | "dotted-key"
    | "mixed"
    | "collision"
    | "not-authored"
    | "shadowed"
    | "path"
    | "unused"
    | "draft"
    | "chain"
    | "optional"

export type ChipVariant = TypePrimitive | RenderHint | StateChip

export interface TypeChipProps {
    variant?: ChipVariant
    value?: unknown
    label?: string
    ambiguousOnly?: boolean
    onClick?: () => void
}

// The fallbacks serve /m, which has no antd variables; the preset variables follow light and dark.
const STYLES: Record<
    ChipVariant,
    {bg: string; fg: string; label: string; border?: string; italic?: boolean}
> = {
    string: {
        bg: "var(--ant-green-1, var(--ag-preset-green-bg))",
        fg: "var(--ant-green-7, var(--ag-preset-green-text))",
        label: "string",
    },
    number: {
        bg: "var(--ant-purple-1, var(--ag-preset-purple-bg))",
        fg: "var(--ant-purple-6, var(--ag-preset-purple-text))",
        label: "number",
    },
    boolean: {
        bg: "var(--ant-orange-1, var(--ag-preset-orange-bg))",
        fg: "var(--ant-orange-7, var(--ag-preset-orange-text))",
        label: "boolean",
    },
    null: {
        bg: "var(--ant-color-fill-secondary, var(--muted))",
        fg: "var(--ant-color-text-tertiary, var(--muted-foreground))",
        label: "null",
    },
    "json-object": {
        bg: "var(--ant-blue-1, var(--ag-preset-blue-bg))",
        fg: "var(--ant-blue-6, var(--ag-preset-blue-text))",
        label: "object",
    },
    "json-array": {
        bg: "var(--ant-cyan-1, var(--ag-preset-cyan-bg))",
        fg: "var(--ant-cyan-6, var(--ag-preset-cyan-text))",
        label: "array",
    },
    markdown: {
        bg: "var(--ant-purple-1, var(--ag-preset-purple-bg))",
        fg: "var(--ant-purple-6, var(--ag-preset-purple-text))",
        label: "markdown",
        border: "1px dashed var(--ant-purple-6, var(--ag-preset-purple-text))",
        italic: true,
    },
    messages: {
        bg: "var(--ant-purple-1, var(--ag-preset-purple-bg))",
        fg: "var(--ant-purple-6, var(--ag-preset-purple-text))",
        label: "messages",
        border: "1px dashed var(--ant-purple-6, var(--ag-preset-purple-text))",
        italic: true,
    },
    "tool-calls": {
        bg: "var(--ant-green-1, var(--ag-preset-green-bg))",
        fg: "var(--ant-green-7, var(--ag-preset-green-text))",
        label: "tool-calls",
        border: "1px dashed var(--ant-green-7, var(--ag-preset-green-text))",
        italic: true,
    },
    "dotted-key": {
        bg: "var(--ant-orange-1, var(--ag-preset-orange-bg))",
        fg: "var(--ant-orange-7, var(--ag-preset-orange-text))",
        label: "dotted-key",
    },
    mixed: {
        bg: "var(--ant-orange-1, var(--ag-preset-orange-bg))",
        fg: "var(--ant-orange-7, var(--ag-preset-orange-text))",
        label: "mixed",
    },
    collision: {
        bg: "var(--ant-red-1, var(--ag-preset-red-bg))",
        fg: "var(--ant-red-6, var(--ag-preset-red-text))",
        label: "⚠ collision",
    },
    shadowed: {
        bg: "var(--ant-red-1, var(--ag-preset-red-bg))",
        fg: "var(--ant-red-6, var(--ag-preset-red-text))",
        label: "⚠ shadowed",
    },
    "not-authored": {
        bg: "var(--ant-color-fill-tertiary, var(--muted))",
        fg: "var(--ant-color-text-secondary, var(--muted-foreground))",
        label: "not authored",
    },
    optional: {
        bg: "var(--ant-color-fill-tertiary, var(--muted))",
        fg: "var(--ant-color-text-secondary, var(--muted-foreground))",
        label: "optional",
    },
    path: {
        bg: "var(--ant-color-fill-secondary, var(--muted))",
        fg: "var(--ant-color-text, var(--foreground))",
        label: "path",
    },
    unused: {
        bg: "var(--ant-color-fill-tertiary, var(--muted))",
        fg: "var(--ant-color-text-secondary, var(--muted-foreground))",
        label: "unused",
    },
    draft: {
        bg: "var(--ant-magenta-1, var(--ag-preset-magenta-bg))",
        fg: "var(--ant-magenta-7, var(--ag-preset-magenta-text))",
        label: "draft",
        border: "1px dashed var(--ant-magenta-7, var(--ag-preset-magenta-text))",
    },
    chain: {
        bg: "var(--ant-geekblue-1, var(--ag-preset-geekblue-bg))",
        fg: "var(--ant-geekblue-7, var(--ag-preset-geekblue-text))",
        label: "chain",
    },
}

const AMBIGUOUS_HIDE = new Set<ChipVariant>(["string", "number", "boolean"])

// Delegates to shared native-type inference. Strings that contain JSON or
// primitive literals remain strings; explicit decode flows parse separately.
const inferVariant = inferLogicalType

function TypeChipImpl({variant, value, label, ambiguousOnly, onClick}: TypeChipProps) {
    const resolved: ChipVariant = variant ?? (value !== undefined ? inferVariant(value) : "string")
    if (ambiguousOnly && AMBIGUOUS_HIDE.has(resolved)) return null

    const style = STYLES[resolved] ?? STYLES.string
    const text = label ?? style.label

    const baseStyle: CSSProperties = {
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        padding: style.border ? "0px 5px" : "1px 6px",
        borderRadius: 4,
        fontSize: 10,
        lineHeight: "16px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        background: style.bg,
        color: style.fg,
        whiteSpace: "nowrap",
        userSelect: "none",
        ...(style.border ? {border: style.border} : undefined),
        ...(style.italic ? {fontStyle: "italic"} : undefined),
    }

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                aria-label={`Type: ${text}`}
                style={{
                    ...baseStyle,
                    cursor: "pointer",
                    border: style.border ?? "1px solid transparent",
                    transition: "transform 0.08s ease, box-shadow 0.08s ease",
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-1px)"
                    e.currentTarget.style.boxShadow = "0 1px 3px rgba(5, 23, 41, 0.12)"
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)"
                    e.currentTarget.style.boxShadow = "none"
                }}
            >
                {text}
            </button>
        )
    }

    return <span style={baseStyle}>{text}</span>
}

export const TypeChip = memo(TypeChipImpl)

export default TypeChip
