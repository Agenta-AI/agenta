/**
 * ChipConversionPopover — turns the type chip into the interactive
 * type-switch affordance the RFC's WP-F1 calls for.
 *
 * The RFC says "type indicator next to each value" + "Convert action between
 * string and JSON." This component collapses both into one: clicking the chip
 * opens a popover with the contextually-valid conversions for that value.
 * The chip stops being passive vocabulary and becomes the unified entry point
 * for type-related operations.
 *
 * Conversion rules (only valid moves are offered):
 *   - string → object/array (parse) · number (if numeric) · boolean (if "true"/"false")
 *   - number → string (stringify)
 *   - boolean → string (stringify)
 *   - null → string "" · number 0 · boolean false · object {} · array []
 *   - object → string (stringify) · array (if values are uniform)
 *   - array → string (stringify) · object (if it's an array of {key, value} pairs)
 *   - messages → array (drops role/content semantics — destructive)
 *   - stringified → object/array (parse) · string (keep as-is)
 *
 * Lossy / destructive conversions surface a warning row in the menu. They
 * still execute on click — the warning replenishes goodwill before the user
 * commits, rather than blocking the action behind a modal.
 */

import {useMemo} from "react"

import {Popover} from "antd"

import type {ChipVariant} from "./TypeChip"

interface ChipConversionPopoverProps {
    /** The chip variant to wrap — drives the menu options */
    variant: ChipVariant
    /** Current value being converted */
    value: unknown
    /** Editor disabled? When false, popover doesn't open */
    editable?: boolean
    /**
     * Called with the converted value when the user picks a type-conversion
     * option. When undefined, the type-conversion section is hidden — useful
     * for read-only contexts (e.g. playground outputs) where conversions
     * don't apply but mode switching does.
     */
    onConvert?: (next: unknown) => void
    /**
     * Optional editor/viewer-mode toggle. When provided AND the chip is a
     * string-related variant (`string` or `markdown`), the popover offers
     * "Render as plain string (inline)" and "Render as markdown (long-form
     * editor)" options that call this callback. The value isn't mutated —
     * only the per-row render-mode pref. Pass `currentMode` so the
     * matching option renders disabled.
     */
    onModeSwitch?: (next: "short" | "long") => void
    /**
     * Current editor mode. Used to disable the matching option in the
     * EDITOR MODE section so the user can see both states but only the
     * inverse is clickable.
     */
    currentMode?: "short" | "long"
    /** Trigger element (the TypeChip itself) */
    children: React.ReactNode
}

interface ConversionOption {
    label: string
    target: ChipVariant | "stringified"
    /** Compute the new value */
    apply: () => unknown
    /** Optional warning shown inline — destructive / lossy */
    warning?: string
    /** When true, the action is currently a no-op (e.g. "keep as-is") */
    isCurrentBehavior?: boolean
}

interface ModeSwitchOption {
    kind: "modeSwitch"
    label: string
    target: "short" | "long"
    targetChip: ChipVariant
    hint?: string
    /** True when this option matches the current mode (rendered disabled) */
    isCurrent?: boolean
}

function isNumericString(s: string): boolean {
    if (s.trim() === "") return false
    return Number.isFinite(Number(s))
}

function isBooleanString(s: string): "true" | "false" | null {
    const trimmed = s.trim().toLowerCase()
    if (trimmed === "true") return "true"
    if (trimmed === "false") return "false"
    return null
}

function tryParseJson(s: string): {parsed: unknown; kind: "object" | "array"} | null {
    if (!s) return null
    const t = s.trim()
    if (t[0] !== "{" && t[0] !== "[") return null
    try {
        const parsed = JSON.parse(t)
        if (Array.isArray(parsed)) return {parsed, kind: "array"}
        if (parsed && typeof parsed === "object") return {parsed, kind: "object"}
    } catch {
        // not parseable
    }
    return null
}

function isUniformArrayOfPairs(value: unknown): value is Array<{key: string; value: unknown}> {
    if (!Array.isArray(value) || value.length === 0) return false
    return value.every(
        (x) =>
            x !== null &&
            typeof x === "object" &&
            "key" in x &&
            "value" in x &&
            typeof (x as {key: unknown}).key === "string",
    )
}

function isUniformObjectOfScalars(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    return Object.values(value as Record<string, unknown>).every(
        (v) =>
            v === null ||
            typeof v === "string" ||
            typeof v === "number" ||
            typeof v === "boolean",
    )
}

function getConversions(
    variant: ChipVariant,
    value: unknown,
): ConversionOption[] {
    const opts: ConversionOption[] = []

    switch (variant) {
        case "string": {
            // String content — type conversions are independent of editor
            // mode (markdown / plain). Mode switching lives in
            // ModeSwitchOption, not here.
            const s = String(value ?? "")
            const parsed = tryParseJson(s)
            if (parsed) {
                opts.push({
                    label: parsed.kind === "object" ? "Parse to object" : "Parse to array",
                    target: parsed.kind === "object" ? "json-object" : "json-array",
                    apply: () => parsed.parsed,
                })
            }
            if (isNumericString(s)) {
                opts.push({
                    label: "Convert to number",
                    target: "number",
                    apply: () => Number(s),
                })
            }
            const boolStr = isBooleanString(s)
            if (boolStr) {
                opts.push({
                    label: "Convert to boolean",
                    target: "boolean",
                    apply: () => boolStr === "true",
                })
            }
            opts.push({
                label: "Set to null",
                target: "null",
                apply: () => null,
                warning: "Drops the string value",
            })
            break
        }

        case "number": {
            opts.push({
                label: "Stringify",
                target: "string",
                apply: () => String(value),
            })
            opts.push({
                label: "Set to null",
                target: "null",
                apply: () => null,
                warning: "Drops the number value",
            })
            break
        }

        case "boolean": {
            opts.push({
                label: "Stringify",
                target: "string",
                apply: () => String(value),
            })
            opts.push({
                label: "Set to null",
                target: "null",
                apply: () => null,
                warning: "Drops the boolean value",
            })
            break
        }

        case "null": {
            opts.push(
                {
                    label: "Initialize as string",
                    target: "string",
                    apply: () => "",
                },
                {
                    label: "Initialize as number",
                    target: "number",
                    apply: () => 0,
                },
                {
                    label: "Initialize as boolean",
                    target: "boolean",
                    apply: () => false,
                },
                {
                    label: "Initialize as object",
                    target: "json-object",
                    apply: () => ({}),
                },
                {
                    label: "Initialize as array",
                    target: "json-array",
                    apply: () => [],
                },
            )
            break
        }

        case "json-object": {
            opts.push({
                label: "Stringify",
                target: "string",
                apply: () => JSON.stringify(value),
            })
            // Uniform scalar object → array of {key, value} pairs
            if (isUniformObjectOfScalars(value)) {
                opts.push({
                    label: "Convert to array of {key, value} pairs",
                    target: "json-array",
                    apply: () =>
                        Object.entries(value as Record<string, unknown>).map(
                            ([key, v]) => ({key, value: v}),
                        ),
                    warning: "Restructures the object",
                })
            }
            opts.push({
                label: "Set to null",
                target: "null",
                apply: () => null,
                warning: "Drops the object",
            })
            break
        }

        case "json-array": {
            opts.push({
                label: "Stringify",
                target: "string",
                apply: () => JSON.stringify(value),
            })
            if (isUniformArrayOfPairs(value)) {
                opts.push({
                    label: "Convert to object",
                    target: "json-object",
                    apply: () => {
                        const arr = value as Array<{key: string; value: unknown}>
                        return arr.reduce<Record<string, unknown>>((acc, item) => {
                            acc[item.key] = item.value
                            return acc
                        }, {})
                    },
                    warning: "Restructures the array",
                })
            }
            opts.push({
                label: "Set to null",
                target: "null",
                apply: () => null,
                warning: "Drops the array",
            })
            break
        }

        case "messages": {
            opts.push({
                label: "Stringify",
                target: "string",
                apply: () => JSON.stringify(value),
            })
            opts.push({
                label: "Convert to plain array",
                target: "json-array",
                apply: () => value,
                warning: "Drops role/content semantics — chat rendering will stop",
            })
            break
        }

        case "stringified": {
            const parsed = tryParseJson(String(value ?? ""))
            if (parsed) {
                opts.push({
                    label:
                        parsed.kind === "object"
                            ? "Parse to object"
                            : "Parse to array",
                    target: parsed.kind === "object" ? "json-object" : "json-array",
                    apply: () => parsed.parsed,
                })
            }
            opts.push({
                label: "Keep as string (current)",
                target: "string",
                apply: () => value,
                isCurrentBehavior: true,
            })
            break
        }

        default:
            // Correctness chips (dotted-key, collision, mixed, shadowed,
            // not-authored, path), state chips (unused, draft, chain,
            // optional), and render-hint chips not handled above
            // (markdown, tool-calls) don't drive type conversion. They
            // get their own action menus — Phase 2.
            break
    }

    return opts
}

function targetLabel(target: ConversionOption["target"] | ChipVariant): string {
    // Mirrors the chip-pill labels in TypeChip's STYLES map so the popover
    // header ("Current chip:") and conversion arrows match what the user
    // sees on the chip itself. Abbreviations for type primitives,
    // full names for render hints + state chips.
    switch (target) {
        case "string":
            return "str"
        case "number":
            return "num"
        case "boolean":
            return "bool"
        case "json-object":
            return "obj"
        case "json-array":
            return "arr"
        case "null":
            return "null"
        case "stringified":
            return "stringified"
        case "messages":
            return "messages"
        case "tool-calls":
            return "tool-calls"
        case "markdown":
            return "markdown"
        default:
            return target
    }
}

function getModeSwitches(
    variant: ChipVariant,
    onModeSwitch: ((next: "short" | "long") => void) | undefined,
    currentMode: "short" | "long" | undefined,
): ModeSwitchOption[] {
    if (!onModeSwitch) return []
    // Mode switching applies to string content. Available on the type chip
    // (`string`) AND on the render-hint chip (`markdown`) so the user can
    // toggle from whichever chip is visible. Both options always show; the
    // current one renders disabled.
    if (variant === "string" || variant === "markdown") {
        return [
            {
                kind: "modeSwitch",
                label: "Render as plain string (inline)",
                target: "short",
                targetChip: "string",
                hint: "Single-line antd Input, edits in the row",
                isCurrent: currentMode === "short",
            },
            {
                kind: "modeSwitch",
                label: "Render as markdown (long-form editor)",
                target: "long",
                targetChip: "markdown",
                hint: "Lexical editor with markdown preview toggle",
                isCurrent: currentMode === "long",
            },
        ]
    }
    return []
}

export function ChipConversionPopover({
    variant,
    value,
    editable = true,
    onConvert,
    onModeSwitch,
    currentMode,
    children,
}: ChipConversionPopoverProps) {
    // Type conversions only computed when onConvert is wired — read-only
    // contexts (output chips) opt out of mutations entirely.
    const conversions = useMemo(
        () => (onConvert ? getConversions(variant, value) : []),
        [variant, value, onConvert],
    )
    const modeSwitches = useMemo(
        () => getModeSwitches(variant, onModeSwitch, currentMode),
        [variant, onModeSwitch, currentMode],
    )

    if (!editable || (conversions.length === 0 && modeSwitches.length === 0)) {
        // Read-only or no valid actions — render the chip plain.
        return <>{children}</>
    }

    const content = (
        <div style={popoverStyles.panel}>
            <div style={popoverStyles.header}>
                <span style={popoverStyles.headerLabel}>Current chip:</span>{" "}
                <span style={popoverStyles.headerValue}>{targetLabel(variant)}</span>
            </div>
            <div style={popoverStyles.divider} />
            {conversions.length > 0 ? (
                <>
                    <div style={popoverStyles.sectionLabel}>Convert type:</div>
                    <div style={popoverStyles.menu}>
                        {conversions.map((opt, i) => (
                            <button
                                key={i}
                                type="button"
                                style={{
                                    ...popoverStyles.option,
                                    ...(opt.warning ? popoverStyles.optionWarning : null),
                                    ...(opt.isCurrentBehavior
                                        ? popoverStyles.optionCurrent
                                        : null),
                                }}
                                onClick={() => onConvert?.(opt.apply())}
                            >
                                <span style={popoverStyles.optionLabel}>{opt.label}</span>
                                <span style={popoverStyles.optionTarget}>
                                    → {targetLabel(opt.target)}
                                </span>
                                {opt.warning ? (
                                    <span style={popoverStyles.optionWarningText}>
                                        ⚠ {opt.warning}
                                    </span>
                                ) : null}
                            </button>
                        ))}
                    </div>
                </>
            ) : null}
            {modeSwitches.length > 0 ? (
                <>
                    {conversions.length > 0 ? (
                        <div style={popoverStyles.divider} />
                    ) : null}
                    <div style={popoverStyles.sectionLabel}>Editor mode:</div>
                    <div style={popoverStyles.menu}>
                        {modeSwitches.map((opt, i) => (
                            <button
                                key={i}
                                type="button"
                                disabled={opt.isCurrent}
                                style={{
                                    ...popoverStyles.option,
                                    ...(opt.isCurrent
                                        ? popoverStyles.optionCurrent
                                        : null),
                                }}
                                onClick={() =>
                                    !opt.isCurrent && onModeSwitch?.(opt.target)
                                }
                            >
                                <span style={popoverStyles.optionLabel}>
                                    {opt.label}
                                    {opt.isCurrent ? (
                                        <span
                                            style={popoverStyles.optionCurrentBadge}
                                        >
                                            current
                                        </span>
                                    ) : null}
                                </span>
                                <span style={popoverStyles.optionTarget}>
                                    → {targetLabel(opt.targetChip)}
                                </span>
                                {opt.hint ? (
                                    <span style={popoverStyles.optionHint}>
                                        {opt.hint}
                                    </span>
                                ) : null}
                            </button>
                        ))}
                    </div>
                </>
            ) : null}
            <div style={popoverStyles.footer}>
                {conversions.length > 0
                    ? "Type conversions change storage shape immediately. Editor-mode changes affect only this row's editor — the value stays untouched."
                    : "Editor-mode changes affect only how this value is displayed — the value itself doesn't change."}
            </div>
        </div>
    )

    return (
        <Popover
            content={content}
            trigger="click"
            placement="bottomLeft"
            destroyTooltipOnHide
            overlayInnerStyle={popoverStyles.overlay}
        >
            {/* Antd Popover injects its click handler via cloneElement on its
                immediate child. TypeChip is a plain function component without
                forwardRef — cloneElement can't attach a working DOM ref, so the
                trigger handler silently fails. Wrapping in a real <span> gives
                antd a DOM element to hang the click on. inline-flex keeps the
                chip baseline-aligned. */}
            <span style={popoverStyles.triggerWrap}>{children}</span>
        </Popover>
    )
}

const popoverStyles = {
    overlay: {
        padding: 0,
        borderRadius: 8,
    },
    triggerWrap: {
        display: "inline-flex",
        alignItems: "center",
        cursor: "pointer",
    },
    panel: {
        minWidth: 240,
        maxWidth: 320,
        fontFamily: "inherit",
    },
    header: {
        padding: "8px 12px",
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.65)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    headerLabel: {
        color: "rgba(5, 23, 41, 0.45)",
    },
    headerValue: {
        color: "#051729",
        fontWeight: 600,
    },
    divider: {
        height: 1,
        background: "rgba(5, 23, 41, 0.08)",
    },
    menu: {
        display: "flex",
        flexDirection: "column" as const,
        padding: 4,
    },
    option: {
        display: "flex",
        flexDirection: "column" as const,
        alignItems: "flex-start" as const,
        gap: 2,
        padding: "6px 10px",
        background: "transparent",
        border: "none",
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 12,
        color: "#051729",
        textAlign: "left" as const,
        transition: "background 0.1s",
    },
    optionLabel: {
        fontWeight: 500,
    },
    optionTarget: {
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.55)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    optionWarning: {},
    optionWarningText: {
        fontSize: 10,
        color: "#d46b08",
        fontStyle: "italic" as const,
        marginTop: 2,
    },
    optionCurrent: {
        opacity: 0.55,
        cursor: "not-allowed" as const,
    },
    optionCurrentBadge: {
        display: "inline-block",
        marginLeft: 8,
        padding: "0 6px",
        borderRadius: 3,
        fontSize: 9,
        fontWeight: 600,
        background: "rgba(5, 23, 41, 0.06)",
        color: "rgba(5, 23, 41, 0.55)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    optionHint: {
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.55)",
        fontStyle: "italic" as const,
        marginTop: 2,
    },
    sectionLabel: {
        fontSize: 10,
        fontWeight: 600,
        color: "rgba(5, 23, 41, 0.55)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        padding: "6px 12px 2px",
    },
    footer: {
        padding: "6px 12px",
        background: "rgba(5, 23, 41, 0.02)",
        borderTop: "1px solid rgba(5, 23, 41, 0.08)",
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.55)",
        lineHeight: 1.5,
        borderRadius: "0 0 8px 8px",
    },
}

export default ChipConversionPopover
