/**
 * TypeChip — proposed chip component that surfaces the result of
 * `detectDataType` on a field's value. This component does NOT exist in
 * production today; it's the gap-01 proposal made real here so design
 * iterations and team discussion can use real React markup.
 *
 * Three orthogonal axes (revised 2026-05-05 per JP feedback to separate
 * type from render hint from state):
 *
 * 1. Type primitive (always one — what the value IS):
 *      string, number, boolean, null, json-object, json-array
 *      Solid background, no border. Display labels: str / num / bool /
 *      null / obj / arr.
 *
 * 2. Render hint (optional — how it's rendered, stacks alongside type):
 *      markdown, stringified, messages, tool-calls
 *      Dashed border + italic so the user reads them as meta about
 *      rendering, not about the value type itself.
 *
 * 3. State / correctness (optional — domain-specific signals, stacks):
 *      dotted-key, mixed, collision, not-authored, shadowed, path,
 *      unused, draft, chain, optional
 *      Solid amber/red/blue palettes per category.
 *
 * Examples:
 *   markdown content  → [str] [markdown]
 *   stringified JSON  → [str] [stringified]
 *   chat messages     → [arr] [messages]
 *   OpenAI tool calls → [arr] [tool-calls]
 *   schema-optional   → [str] [optional]
 *
 * Props can override the detected type for "ambiguous-only" placement
 * (gap-01 Variant C: hide chip when rendering already disambiguates).
 */

import {detectDataType, type DataType} from "@agenta/ui/drill-in"

/**
 * Type primitive — what the value IS. Always one of these per chip
 * emission. Mirrors JSON's primitive types.
 */
export type TypePrimitive = DataType // string|number|boolean|null|json-object|json-array

/**
 * Render hint — how a value is rendered. Optional; stacks alongside the
 * type chip. Visually distinct (dashed border + italic) so the user reads
 * "render mode" rather than "type".
 */
export type RenderHint = "markdown" | "stringified" | "messages" | "tool-calls"

/**
 * State / correctness chips. Domain-specific signals that stack alongside
 * the type + render-hint chips. `optional` (added per JP feedback) marks
 * a schema-defined-but-not-required field.
 */
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

interface TypeChipProps {
    /** Force a specific chip; otherwise inferred from value */
    variant?: ChipVariant
    /** Value used to infer the chip when `variant` is not set */
    value?: unknown
    /** Optional label override (e.g. "messages" → "5 messages") */
    label?: string
    /** Hide chip when the type is "ambiguous-only" — strings/numbers/booleans */
    ambiguousOnly?: boolean
    /**
     * When provided, the chip becomes interactive — renders as a button with
     * cursor pointer + hover lift, gets a focus ring, and fires onClick. Used
     * by ChipConversionPopover to make the chip the entry point for type
     * switching (RFC WP-F1's "Convert action" collapsed into the indicator).
     */
    onClick?: (e: React.MouseEvent<HTMLElement>) => void
    /** Optional aria-label override (e.g. "Convert type") */
    ariaLabel?: string
    /**
     * When true, render a small pulsing dot in the chip's top-right corner.
     * Used to nudge the user that an action is available (e.g. "you've typed
     * past the long-form threshold — consider switching editor"). The chip
     * stays clickable and the action lives in the popover; the badge is just
     * a visibility cue, not a separate button.
     */
    notificationBadge?: boolean
    /** Optional title/tooltip when the badge is shown */
    badgeTooltip?: string
}

const STYLES: Record<
    ChipVariant,
    {bg: string; fg: string; label: string; border?: string; italic?: boolean}
> = {
    // — Type primitives (axis 1). Solid background, no border, full type
    //   names so SMEs reading the chip don't have to translate `obj` → object.
    //   The "json-" prefix on the variant key stays for TS precision when
    //   grepping; the visible label drops it for legibility.
    string: {bg: "rgba(5, 23, 41, 0.06)", fg: "#051729", label: "string"},
    number: {bg: "rgba(5, 23, 41, 0.06)", fg: "#051729", label: "number"},
    boolean: {bg: "rgba(5, 23, 41, 0.06)", fg: "#051729", label: "boolean"},
    null: {bg: "rgba(5, 23, 41, 0.06)", fg: "rgba(5, 23, 41, 0.45)", label: "null"},
    "json-object": {bg: "#e6f4ff", fg: "#1677ff", label: "object"},
    "json-array": {bg: "#e6fffb", fg: "#13c2c2", label: "array"},

    // — Render hints (axis 2). Dashed border + italic so the user reads
    //   "render mode" not "type". Each one stacks alongside the type chip.
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

    // — State / correctness chips (axis 3). Solid backgrounds in semantic
    //   palettes: amber for "watch out", red for "error", blue/grey for
    //   variable provenance.
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
    // gap-09 — variable provenance / usage. Muted palettes; meta about
    // the variable's role in the run, not its value type.
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

/**
 * Infer the type-primitive chip from a value. Returns one of
 * `string` / `number` / `boolean` / `null` / `json-object` / `json-array`
 * — never a render-hint variant. Use `inferRenderHint` separately when
 * the caller wants to show render-hint chips alongside the type chip.
 */
function inferVariant(value: unknown): TypePrimitive {
    if (value === null) return "null"
    if (Array.isArray(value)) return "json-array"
    if (typeof value === "object") return "json-object"
    if (typeof value === "boolean") return "boolean"
    if (typeof value === "number") return "number"
    return "string"
}

/**
 * Infer the optional render-hint chip for a value. Returns:
 *   - `messages` if the value is an array of chat-message-shaped objects
 *   - `tool-calls` if the value is an array of OpenAI tool-call-shaped objects
 *   - `stringified` if the value is a string that parses as JSON object/array
 *   - `markdown` if the value is a long / multi-line / markdown string
 *   - null otherwise
 *
 * Render hints are orthogonal to type primitives — caller emits both chips
 * (type + hint) when this returns non-null.
 */
export function inferRenderHint(value: unknown): RenderHint | null {
    if (Array.isArray(value)) {
        if (value.length === 0) return null
        const first = value[0]
        if (first && typeof first === "object") {
            if ("role" in first) return "messages"
            if (
                "type" in first &&
                (first as {type?: unknown}).type === "function" &&
                "function" in first
            ) {
                return "tool-calls"
            }
        }
        return null
    }
    if (typeof value === "string") {
        if (value.length >= 2 && (value[0] === "{" || value[0] === "[")) {
            try {
                const parsed = JSON.parse(value)
                if (parsed && typeof parsed === "object") return "stringified"
            } catch {
                /* not parseable, fall through */
            }
        }
        // Markdown / multi-line heuristic — same threshold the editor uses
        // when picking between the inline antd Input and the Lexical editor.
        if (value.length > 100 || value.includes("\n")) return "markdown"
        return null
    }
    return null
}

export function TypeChip({
    variant,
    value,
    label,
    ambiguousOnly,
    onClick,
    ariaLabel,
    notificationBadge,
    badgeTooltip,
}: TypeChipProps) {
    const resolved: ChipVariant = variant ?? (value !== undefined ? inferVariant(value) : "string")
    if (ambiguousOnly && AMBIGUOUS_HIDE.has(resolved)) {
        return null
    }
    const style = STYLES[resolved] ?? STYLES.string
    const text = label ?? style.label

    const baseStyle: React.CSSProperties = {
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: 10,
        lineHeight: "16px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        background: style.bg,
        color: style.fg,
        whiteSpace: "nowrap",
        userSelect: "none",
        ...(style.border ? {border: style.border, padding: "0px 5px"} : null),
        ...(style.italic ? {fontStyle: "italic"} : null),
    }

    const badgeNode = notificationBadge ? (
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
                boxShadow: "0 0 0 0 rgba(114, 46, 209, 0.6)",
                animation: "chipBadgePulse 1.6s ease-out infinite",
                pointerEvents: "none",
            }}
        />
    ) : null

    // Interactive: render as a real <button> so keyboard focus + a11y come
    // for free. Hover lift signals affordance; the focus-visible ring
    // guarantees the convention.
    if (onClick) {
        return (
            <>
                <BadgeKeyframes />
                <button
                    type="button"
                    onClick={onClick}
                    aria-label={ariaLabel ?? `Convert type from ${text}`}
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
                    {badgeNode}
                </button>
            </>
        )
    }

    return (
        <>
            <BadgeKeyframes />
            <span style={baseStyle}>
                {text}
                {badgeNode}
            </span>
        </>
    )
}

/**
 * Inject the badge pulse keyframes once per page (idempotent — repeated
 * mounts don't duplicate the rule because we tag the style element with a
 * known id and bail if it's already present).
 */
function BadgeKeyframes() {
    if (typeof document === "undefined") return null
    if (!document.getElementById("type-chip-badge-keyframes")) {
        const style = document.createElement("style")
        style.id = "type-chip-badge-keyframes"
        style.textContent = `
@keyframes chipBadgePulse {
    0% { box-shadow: 0 0 0 0 rgba(114, 46, 209, 0.6); }
    70% { box-shadow: 0 0 0 5px rgba(114, 46, 209, 0); }
    100% { box-shadow: 0 0 0 0 rgba(114, 46, 209, 0); }
}
`
        document.head.appendChild(style)
    }
    return null
}

export default TypeChip
