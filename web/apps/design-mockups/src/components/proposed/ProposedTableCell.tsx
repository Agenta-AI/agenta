/**
 * ProposedTableCell — gap-02 proposal made real. Shows the same chip
 * vocabulary as ProposedDrillIn (gap-01) plus a 2-line preview:
 *
 *   line 1: [chip] count   (e.g. [obj] { 4 props })
 *   line 2: comma-separated first 2-3 keys / values
 *
 * For string/number/boolean values: renders inline like the production
 * cell (no chip, ambiguous-only rule).
 * For null: dimmed [null] chip, no preview.
 * For missing keys: em-dash (the only legitimate em-dash use).
 * For messages arrays: [messages] chip + count + first role label.
 */

import type {ChipRenderMode} from "./ProposedDrillIn"
import {TypeChip} from "./TypeChip"

interface ProposedTableCellProps {
    value: unknown
    /** Set to true if this column has heterogeneous types across rows (gap-02 [mixed]) */
    isMixedColumn?: boolean
    /** Set to true if the column header is a literal-dot key (gap-05 [dotted-key]) */
    isDottedKey?: boolean
    /** Set to true if the row has a literal-vs-nested collision (gap-05) */
    isCollision?: boolean
    /** Treat undefined as "missing key" (em-dash) rather than empty */
    treatUndefinedAsMissing?: boolean
    /**
     * Chip rendering mode (gap-01 alignment, added 2026-05-04). `all` shows
     * every chip; `ambiguous-only` hides chips for primitives where the
     * inline value already disambiguates the type; `none` hides type chips
     * entirely and signals types via value styling. Correctness chips
     * ([dotted-key], [⚠ collision], [mixed]) are always shown — they're
     * warnings, not vocabulary.
     */
    chipMode?: ChipRenderMode
}

function isMessagesArray(value: unknown[]): boolean {
    return (
        value.length > 0 &&
        value.every(
            (item) =>
                item != null &&
                typeof item === "object" &&
                "role" in (item as object) &&
                ("content" in (item as object) || "tool_calls" in (item as object)),
        )
    )
}

function isToolCallsArray(value: unknown[]): boolean {
    return (
        value.length > 0 &&
        value.every(
            (item) =>
                item != null &&
                typeof item === "object" &&
                (item as {type?: unknown}).type === "function" &&
                "function" in (item as object),
        )
    )
}

function tryParseStringifiedJson(s: string): unknown | null {
    if (s.length < 2) return null
    const first = s[0]
    if (first !== "{" && first !== "[") return null
    try {
        return JSON.parse(s)
    } catch {
        return null
    }
}

export function ProposedTableCell({
    value,
    isMixedColumn,
    isDottedKey,
    isCollision,
    treatUndefinedAsMissing,
    chipMode = "all",
}: ProposedTableCellProps) {
    const showTypeChip = chipMode !== "none"
    // missing key
    if (value === undefined && treatUndefinedAsMissing) {
        return <span style={styles.missing}>—</span>
    }

    // null
    if (value === null) {
        return (
            <span style={styles.cell}>
                {showTypeChip ? (
                    <TypeChip variant="null" />
                ) : (
                    <span style={styles.styledNull}>null</span>
                )}
                {isCollision && <TypeChip variant="collision" />}
            </span>
        )
    }

    // primitives — string/number/boolean — no chip per gap-02 ambiguous-only rule
    if (typeof value === "string") {
        // Stringified-JSON: emit type chip + render-hint chip (separate axes
        // per JP feedback 2026-05-05). [str] says "value is a string", and
        // [stringified] says "and it parses as JSON". The "parse?" button
        // lets the user opt into the structured preview.
        const parsed = tryParseStringifiedJson(value)
        if (parsed !== null) {
            const shape = Array.isArray(parsed)
                ? `[ ${parsed.length} items ]`
                : typeof parsed === "object" && parsed !== null
                  ? `{ ${Object.keys(parsed).length} props }`
                  : String(parsed)
            return (
                <span style={styles.cell}>
                    <span style={styles.line}>
                        {showTypeChip && <TypeChip variant="string" />}
                        {showTypeChip && <TypeChip variant="stringified" />}
                        <span style={styles.muted}>{shape}</span>
                        <button type="button" style={styles.parseAffordance}>
                            parse?
                        </button>
                    </span>
                    <span
                        style={
                            chipMode === "none"
                                ? {...styles.preview, ...styles.styledStringified}
                                : styles.preview
                        }
                    >
                        {value.slice(0, 60)}…
                    </span>
                </span>
            )
        }
        return (
            <span style={styles.cellInline}>
                <span style={styles.stringValue}>"{value}"</span>
                {isDottedKey && <TypeChip variant="dotted-key" />}
                {isCollision && <TypeChip variant="collision" />}
            </span>
        )
    }
    if (typeof value === "number") {
        return (
            <span style={styles.cellInline}>
                <span
                    style={chipMode === "none" ? styles.styledNumber : styles.monoValue}
                >
                    {String(value)}
                </span>
                {isMixedColumn && <TypeChip variant="mixed" />}
            </span>
        )
    }
    if (typeof value === "boolean") {
        return (
            <span style={styles.cellInline}>
                <span
                    style={
                        chipMode === "none"
                            ? styles.styledBoolean(value)
                            : styles.monoValue
                    }
                >
                    {String(value)}
                </span>
                {isMixedColumn && <TypeChip variant="mixed" />}
            </span>
        )
    }

    // object
    if (typeof value === "object" && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>
        const keys = Object.keys(obj)
        const sampleKeys = keys.slice(0, 3).join(", ")
        return (
            <span style={styles.cell}>
                <span style={styles.line}>
                    {showTypeChip && <TypeChip variant="json-object" />}
                    <span
                        style={chipMode === "none" ? styles.styledObject : styles.muted}
                    >{`{ ${keys.length} props }`}</span>
                    {isMixedColumn && <TypeChip variant="mixed" />}
                </span>
                <span style={styles.preview}>{sampleKeys}</span>
            </span>
        )
    }

    // array — could be messages or tool-calls
    if (Array.isArray(value)) {
        if (isMessagesArray(value)) {
            const firstRole = (value[0] as {role?: string}).role ?? "?"
            return (
                <span style={styles.cell}>
                    <span style={styles.line}>
                        {showTypeChip && <TypeChip variant="json-array" />}
                        {showTypeChip && <TypeChip variant="messages" />}
                        <span
                            style={chipMode === "none" ? styles.styledMessages : styles.muted}
                        >
                            {value.length} messages
                        </span>
                    </span>
                    <span style={styles.preview}>starts with {firstRole}…</span>
                </span>
            )
        }
        if (isToolCallsArray(value)) {
            const firstName =
                (value[0] as {function?: {name?: string}}).function?.name ?? "?"
            return (
                <span style={styles.cell}>
                    <span style={styles.line}>
                        {showTypeChip && <TypeChip variant="json-array" />}
                        {showTypeChip && <TypeChip variant="tool-calls" />}
                        <span style={styles.muted}>
                            {value.length} call
                            {value.length === 1 ? "" : "s"}
                        </span>
                    </span>
                    <span style={styles.preview}>first: {firstName}…</span>
                </span>
            )
        }
        const sample = value
            .slice(0, 3)
            .map((v) =>
                typeof v === "string" ? `"${v.slice(0, 16)}"` : typeof v === "object" ? "{…}" : String(v),
            )
            .join(", ")
        return (
            <span style={styles.cell}>
                <span style={styles.line}>
                    {showTypeChip && <TypeChip variant="json-array" />}
                    <span
                        style={chipMode === "none" ? styles.styledArray : styles.muted}
                    >
                        {`[ ${value.length} items ]`}
                    </span>
                    {isMixedColumn && <TypeChip variant="mixed" />}
                </span>
                <span style={styles.preview}>{sample}</span>
            </span>
        )
    }

    return <span>{String(value)}</span>
}

const styles = {
    cell: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 4,
        fontSize: 11,
        lineHeight: 1.4,
    },
    cellInline: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
    },
    line: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
    },
    stringValue: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "#0a3069",
    },
    monoValue: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "#051729",
    },
    muted: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.55)",
    },
    preview: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.65)",
        whiteSpace: "nowrap" as const,
        overflow: "hidden" as const,
        textOverflow: "ellipsis" as const,
    },
    missing: {
        color: "rgba(5, 23, 41, 0.35)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    parseAffordance: {
        fontSize: 10,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        padding: "0px 6px",
        marginLeft: 2,
        borderRadius: 3,
        background: "white",
        color: "#1677ff",
        border: "1px solid rgba(22, 119, 255, 0.4)",
        cursor: "pointer",
        lineHeight: "16px",
    },
    // Type-driven value styles for chipMode="none". Each type has a distinct
    // visual treatment so the user can read type-from-value without a chip.
    styledNumber: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "#722ed1",
        fontVariantNumeric: "tabular-nums" as const,
    },
    styledBoolean: (v: boolean) =>
        ({
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            color: v ? "#389e0d" : "#cf1322",
            fontWeight: 600,
        }) as const,
    styledNull: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "rgba(5, 23, 41, 0.45)",
        fontStyle: "italic" as const,
        fontSize: 11,
    },
    styledObject: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
        color: "#1677ff",
    },
    styledArray: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
        color: "#13c2c2",
    },
    styledMessages: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
        color: "#722ed1",
        fontWeight: 500,
    },
    styledStringified: {
        fontStyle: "italic" as const,
        color: "#1677ff",
        background: "#e6f4ff",
        padding: "1px 4px",
        borderRadius: 3,
        border: "1px dashed #1677ff",
    },
}

export default ProposedTableCell
