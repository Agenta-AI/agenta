import type {CSSProperties} from "react"

import {tryParseJson} from "@agenta/shared/utils"

export type TypePrimitive = "string" | "number" | "boolean" | "null" | "json-object" | "json-array"

export type RenderHint = "markdown" | "stringified" | "messages" | "tool-calls"

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
    notificationBadge?: boolean
    badgeTooltip?: string
}

const STYLES: Record<
    ChipVariant,
    {bg: string; fg: string; label: string; border?: string; italic?: boolean}
> = {
    string: {bg: "#f6ffed", fg: "#389e0d", label: "string"},
    number: {bg: "#f9f0ff", fg: "#722ed1", label: "number"},
    boolean: {bg: "#fff7e6", fg: "#d46b08", label: "boolean"},
    null: {bg: "rgba(5, 23, 41, 0.06)", fg: "rgba(5, 23, 41, 0.45)", label: "null"},
    "json-object": {bg: "#e6f4ff", fg: "#1677ff", label: "object"},
    "json-array": {bg: "#e6fffb", fg: "#13c2c2", label: "array"},
    markdown: {
        bg: "#f9f0ff",
        fg: "#722ed1",
        label: "markdown",
        border: "1px dashed #722ed1",
        italic: true,
    },
    stringified: {
        bg: "#e6f4ff",
        fg: "#1677ff",
        label: "stringified",
        border: "1px dashed #1677ff",
        italic: true,
    },
    messages: {
        bg: "#f9f0ff",
        fg: "#722ed1",
        label: "messages",
        border: "1px dashed #722ed1",
        italic: true,
    },
    "tool-calls": {
        bg: "#f6ffed",
        fg: "#389e0d",
        label: "tool-calls",
        border: "1px dashed #389e0d",
        italic: true,
    },
    "dotted-key": {bg: "#fff7e6", fg: "#d46b08", label: "dotted-key"},
    mixed: {bg: "#fff7e6", fg: "#d46b08", label: "mixed"},
    collision: {bg: "#fff2f0", fg: "#f5222d", label: "⚠ collision"},
    shadowed: {bg: "#fff2f0", fg: "#f5222d", label: "⚠ shadowed"},
    "not-authored": {
        bg: "rgba(5, 23, 41, 0.04)",
        fg: "rgba(5, 23, 41, 0.55)",
        label: "not authored",
    },
    optional: {
        bg: "rgba(5, 23, 41, 0.04)",
        fg: "rgba(5, 23, 41, 0.55)",
        label: "optional",
    },
    path: {bg: "rgba(5, 23, 41, 0.06)", fg: "#051729", label: "path"},
    unused: {
        bg: "rgba(5, 23, 41, 0.04)",
        fg: "rgba(5, 23, 41, 0.55)",
        label: "unused",
    },
    draft: {
        bg: "#fff0f6",
        fg: "#c41d7f",
        label: "draft",
        border: "1px dashed #c41d7f",
    },
    chain: {
        bg: "#f0f5ff",
        fg: "#1d39c4",
        label: "chain",
    },
}

const AMBIGUOUS_HIDE = new Set<ChipVariant>(["string", "number", "boolean"])

function inferVariant(value: unknown): TypePrimitive {
    if (value === null) return "null"
    if (Array.isArray(value)) return "json-array"
    if (typeof value === "object") return "json-object"
    if (typeof value === "boolean") return "boolean"
    if (typeof value === "number") return "number"
    // Stringified JSON (object/array) — common in legacy testcase cells and
    // playground writes that historically forced `string`. Reflect the logical
    // type so the chip matches what the testset table shows for the same data.
    if (typeof value === "string" && value.length >= 2) {
        const first = value[0]
        if (first === "{" || first === "[") {
            const parsed = tryParseJson(value)
            if (Array.isArray(parsed)) return "json-array"
            if (parsed !== null && typeof parsed === "object") return "json-object"
        }
    }
    return "string"
}

if (typeof document !== "undefined" && !document.getElementById("type-chip-badge-keyframes")) {
    const s = document.createElement("style")
    s.id = "type-chip-badge-keyframes"
    s.textContent = `@keyframes chipBadgePulse {
    0% { box-shadow: 0 0 0 0 rgba(114, 46, 209, 0.6); }
    70% { box-shadow: 0 0 0 5px rgba(114, 46, 209, 0); }
    100% { box-shadow: 0 0 0 0 rgba(114, 46, 209, 0); }
}`
    document.head.appendChild(s)
}

export function TypeChip({
    variant,
    value,
    label,
    ambiguousOnly,
    onClick,
    notificationBadge,
    badgeTooltip,
}: TypeChipProps) {
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

    const badge = notificationBadge ? (
        <span
            aria-hidden="true"
            title={badgeTooltip}
            style={{
                position: "absolute",
                top: -3,
                right: -3,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#722ed1",
                border: "1.5px solid white",
                animation: "chipBadgePulse 1.6s ease-out infinite",
                pointerEvents: "none",
            }}
        />
    ) : null

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                aria-label={`Type: ${text}`}
                title={badgeTooltip}
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
                {badge}
            </button>
        )
    }

    return (
        <span style={baseStyle}>
            {text}
            {badge}
        </span>
    )
}

export default TypeChip
