import type {CSSProperties} from "react"

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
    notificationBadge?: boolean
    badgeTooltip?: string
}

const STYLES: Record<
    ChipVariant,
    {bg: string; fg: string; label: string; border?: string; italic?: boolean}
> = {
    string: {bg: "var(--ant-green-1)", fg: "var(--ant-green-7)", label: "string"},
    number: {bg: "var(--ant-purple-1)", fg: "var(--ant-purple-6)", label: "number"},
    boolean: {bg: "var(--ant-orange-1)", fg: "var(--ant-orange-7)", label: "boolean"},
    null: {
        bg: "var(--ant-color-fill-secondary)",
        fg: "var(--ant-color-text-tertiary)",
        label: "null",
    },
    "json-object": {bg: "var(--ant-blue-1)", fg: "var(--ant-blue-6)", label: "object"},
    "json-array": {bg: "var(--ant-cyan-1)", fg: "var(--ant-cyan-6)", label: "array"},
    markdown: {
        bg: "var(--ant-purple-1)",
        fg: "var(--ant-purple-6)",
        label: "markdown",
        border: "1px dashed var(--ant-purple-6)",
        italic: true,
    },
    messages: {
        bg: "var(--ant-purple-1)",
        fg: "var(--ant-purple-6)",
        label: "messages",
        border: "1px dashed var(--ant-purple-6)",
        italic: true,
    },
    "tool-calls": {
        bg: "var(--ant-green-1)",
        fg: "var(--ant-green-7)",
        label: "tool-calls",
        border: "1px dashed var(--ant-green-7)",
        italic: true,
    },
    "dotted-key": {bg: "var(--ant-orange-1)", fg: "var(--ant-orange-7)", label: "dotted-key"},
    mixed: {bg: "var(--ant-orange-1)", fg: "var(--ant-orange-7)", label: "mixed"},
    collision: {bg: "var(--ant-red-1)", fg: "var(--ant-red-6)", label: "⚠ collision"},
    shadowed: {bg: "var(--ant-red-1)", fg: "var(--ant-red-6)", label: "⚠ shadowed"},
    "not-authored": {
        bg: "var(--ant-color-fill-tertiary)",
        fg: "var(--ant-color-text-secondary)",
        label: "not authored",
    },
    optional: {
        bg: "var(--ant-color-fill-tertiary)",
        fg: "var(--ant-color-text-secondary)",
        label: "optional",
    },
    path: {bg: "var(--ant-color-fill-secondary)", fg: "var(--ant-color-text)", label: "path"},
    unused: {
        bg: "var(--ant-color-fill-tertiary)",
        fg: "var(--ant-color-text-secondary)",
        label: "unused",
    },
    draft: {
        bg: "var(--ant-magenta-1)",
        fg: "var(--ant-magenta-7)",
        label: "draft",
        border: "1px dashed var(--ant-magenta-7)",
    },
    chain: {
        bg: "var(--ant-geekblue-1)",
        fg: "var(--ant-geekblue-7)",
        label: "chain",
    },
}

const AMBIGUOUS_HIDE = new Set<ChipVariant>(["string", "number", "boolean"])

// Delegates to shared native-type inference. Strings that contain JSON or
// primitive literals remain strings; explicit decode flows parse separately.
const inferVariant = inferLogicalType

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
                background: "var(--ant-purple-6)",
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
