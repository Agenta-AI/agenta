/**
 * TypeChip — proposed chip component that surfaces the result of
 * `detectDataType` on a field's value. This component does NOT exist in
 * production today; it's the gap-01 proposal made real here so design
 * iterations and team discussion can use real React markup.
 *
 * Vocabulary mirrors `docs/designs/json-string-ux/variants/gap-01-type-chips.html`:
 *   [str] grey · [obj] blue · [arr] cyan · [num] grey · [bool] grey ·
 *   [null] dimmed · [msgs] purple · [dotted-key] amber · [mixed] amber ·
 *   [⚠ collision] red · [tool] green · [stringified] dashed-blue
 *
 * The `stringified` variant (added 2026-05-04 from competitive analysis §13)
 * marks fields *stored as JSON strings* — the gap-02/04 fault line that
 * Braintrust shares. Distinct from `[obj]` / `[arr]` which mark *parsed*
 * values, even when the source was a string. The chip's italic label + dashed
 * border carry the "this is technically a string" signal.
 *
 * Props can override the detected type for "ambiguous-only" placement (gap-01
 * Variant C: hide chip when rendering already disambiguates the type).
 */

import {detectDataType, type DataType} from "@agenta/ui/drill-in"

export type ChipVariant =
    | DataType
    | "dotted-key"
    | "mixed"
    | "tool"
    | "collision"
    | "not-authored"
    | "shadowed"
    | "path"
    | "stringified"
    | "long-str"
    // Variable-state chips for gap-09 (playground execution item provenance).
    // `unused`  — variable on the testcase but not referenced by any prompt
    //             in the chain. Default-collapsed in the UI; the chip surfaces
    //             when the user clicks "Show unused".
    // `draft`   — variable referenced in a prompt template (`{{x}}`) that
    //             doesn't exist on the testcase yet. Lives only in the local
    //             draft until the user explicitly syncs to the testset.
    // `chain`   — variable used by some prompts in the chain but not all.
    //             The chip carries which prompts via the `label` override
    //             (e.g. "prompt 1, 3 of 4").
    | "unused"
    | "draft"
    | "chain"

interface TypeChipProps {
    /** Force a specific chip; otherwise inferred from value */
    variant?: ChipVariant
    /** Value used to infer the chip when `variant` is not set */
    value?: unknown
    /** Optional label override (e.g. "msgs" → "5 msgs") */
    label?: string
    /** Hide chip when the type is "ambiguous-only" — strings/numbers/booleans */
    ambiguousOnly?: boolean
    /**
     * When true and `value` is a string that parses as JSON, render the
     * `stringified` chip instead of `[obj]` / `[arr]`. Used in the table-cell
     * context where preserving "this is stored as a string" is meaningful.
     */
    preferStringified?: boolean
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
    string: {bg: "rgba(5, 23, 41, 0.06)", fg: "#051729", label: "str"},
    "json-object": {bg: "#e6f4ff", fg: "#1677ff", label: "obj"},
    "json-array": {bg: "#e6fffb", fg: "#13c2c2", label: "arr"},
    number: {bg: "rgba(5, 23, 41, 0.06)", fg: "#051729", label: "num"},
    boolean: {bg: "rgba(5, 23, 41, 0.06)", fg: "#051729", label: "bool"},
    null: {bg: "rgba(5, 23, 41, 0.06)", fg: "rgba(5, 23, 41, 0.45)", label: "null"},
    messages: {bg: "#f9f0ff", fg: "#722ed1", label: "msgs"},
    "dotted-key": {bg: "#fff7e6", fg: "#d46b08", label: "dotted-key"},
    mixed: {bg: "#fff7e6", fg: "#d46b08", label: "mixed"},
    tool: {bg: "#f6ffed", fg: "#389e0d", label: "tool"},
    collision: {bg: "#fff2f0", fg: "#f5222d", label: "⚠ collision"},
    "not-authored": {bg: "rgba(5, 23, 41, 0.04)", fg: "rgba(5, 23, 41, 0.55)", label: "not authored"},
    shadowed: {bg: "#fff2f0", fg: "#f5222d", label: "⚠ shadowed"},
    path: {bg: "rgba(5, 23, 41, 0.06)", fg: "#051729", label: "path"},
    stringified: {
        bg: "#e6f4ff",
        fg: "#1677ff",
        // `json-str` reads as "JSON value, stored as a string" — the conflict
        // spelled out instead of carried by italic + quotes + dashed border
        // alone. Styling stays as a bonus signal but the label survives if
        // it gets stripped (e.g. in copy-paste, accessibility tree readouts).
        label: "json-str",
        border: "1px dashed #1677ff",
        italic: true,
    },
    "long-str": {
        // `long-str` is the editor-mode chip for string content rendered with
        // the production Lexical editor (markdown preview toggle + multi-line).
        // Distinct from `[str]` (inline single-line antd Input) — clicking the
        // chip toggles between the two modes via ChipConversionPopover. Used
        // when content is multi-paragraph, contains markdown, or the user
        // explicitly opts into the long-form editor for shorter content.
        bg: "#f9f0ff",
        fg: "#722ed1",
        label: "long-str",
    },
    // gap-09 — variable provenance / usage chips. Muted neutral palette
    // because these are *meta* about the variable's role in the run, not
    // about its value type — they sit alongside the type chip rather than
    // replacing it.
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

function inferVariant(value: unknown, preferStringified = false): ChipVariant {
    if (value === null) return "null"
    if (Array.isArray(value)) return "json-array"
    if (typeof value === "object") return "json-object"
    if (typeof value === "boolean") return "boolean"
    if (typeof value === "number") return "number"
    if (typeof value === "string") {
        // Use detectDataType for stringified-JSON detection
        const detected = detectDataType(value)
        if (
            preferStringified &&
            (detected === "json-object" || detected === "json-array")
        ) {
            return "stringified"
        }
        return detected
    }
    return "string"
}

export function TypeChip({
    variant,
    value,
    label,
    ambiguousOnly,
    preferStringified,
    onClick,
    ariaLabel,
    notificationBadge,
    badgeTooltip,
}: TypeChipProps) {
    const resolved =
        variant ??
        (value !== undefined ? inferVariant(value, preferStringified) : "string")
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
                        e.currentTarget.style.boxShadow =
                            "0 1px 3px rgba(5, 23, 41, 0.12)"
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
