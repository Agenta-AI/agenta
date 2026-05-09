/**
 * ProposedTableCell — gap-02 proposal made real. Mirrors the chip
 * philosophy ProposedDrillIn settled on (2026-05-05): the chip area
 * carries the *native type* only; render hints (stringified / markdown /
 * messages / tool-calls) live in the count + preview text instead of as
 * a second chip; correctness warnings ([dotted-key], [⚠ collision],
 * [mixed]) consolidate into a single Warning-icon + tooltip via
 * `CellWarningsIndicator`, mirroring `FieldWarningsIndicator` in the
 * drill-in. Two-line preview shape is unchanged:
 *
 *   line 1: [type-chip] count [info?] [⚠ warnings?]
 *   line 2: comma-separated first 2-3 keys / values (or markdown head,
 *           or "starts with <role>…" for messages)
 *
 * For string/number/boolean values: renders inline like the production
 * cell (no chip, ambiguous-only rule).
 * For null: dimmed [null] chip, no preview.
 * For missing keys: em-dash.
 */

import {Info, Warning} from "@phosphor-icons/react"
import {Tooltip} from "antd"

import {ChatMessagesCellContent} from "@agenta/ui/cell-renderers"

import type {ChipRenderMode} from "./ProposedDrillIn"
import {TypeChip, type ChipVariant} from "./TypeChip"

/**
 * Native-type vocabulary for table columns. Same set ProposedDrillIn /
 * TypeChip use, narrowed to what the column-detection helper emits. Kept
 * local so the cell file doesn't pull in the helpers' module just for a
 * type alias.
 */
type CellColumnType = "string" | "number" | "boolean" | "null" | "json-object" | "json-array"

interface ProposedTableCellProps {
    value: unknown
    /**
     * The column's declared native type (from `detectColumnTypes`). When
     * supplied, the cell suppresses its own type chip whenever the value's
     * own type matches — the header already carries that information, so
     * repeating it on every row reads as visual noise. The cell still
     * renders a type chip when the value diverges from the column's
     * declared type (e.g. a `null` cell in an otherwise-string column),
     * so row-specific deviations stay visible.
     */
    columnType?: CellColumnType
    /** Treat undefined as "missing key" (em-dash) rather than empty */
    treatUndefinedAsMissing?: boolean
    /**
     * Maximum visible lines for wrapped content — mirrors production's
     * row-height vocabulary (small=4 / medium=10 / large=18). Drives a
     * CSS `-webkit-line-clamp` on the value span so multi-line content
     * (markdown blobs, deep objects) wraps and truncates instead of
     * either hard-clipping at one line or blowing out the column width.
     * Default: 10 (matches production's medium row height).
     */
    maxLines?: number
    /**
     * When the column header already carries the parse-on-detect action
     * (uniformly stringified column → "parse?" button on the column
     * header), the per-cell parse affordance + storage Info icon are
     * suppressed. Parse becomes a column-level action with one click,
     * not a button repeated on every row. The cell still shows its
     * parsed-shape count + preview so the user can see what each row
     * holds — the action vocabulary just stops repeating.
     */
    omitParseAffordance?: boolean
    /**
     * Chip rendering mode (gap-01 alignment, added 2026-05-04). `all` shows
     * every chip; `ambiguous-only` hides chips for primitives where the
     * inline value already disambiguates the type; `none` hides type chips
     * entirely and signals types via value styling. Column-level warnings
     * ([dotted-key], [⚠ collision], [mixed]) are no longer rendered per
     * cell — the column header's consolidated Warning indicator carries
     * them once for the whole column instead of repeating on every row.
     */
    chipMode?: ChipRenderMode
}

/** Map a value to the native-type vocabulary `detectColumnTypes` uses
 *  so we can compare cell type vs column type without re-importing the
 *  helper's enum. Returns `null` for stringified-JSON because that's a
 *  string at the storage level — the column is `string`, not anything
 *  parsed. */
function inferCellNativeType(value: unknown): CellColumnType | null {
    if (value === null) return "null"
    if (Array.isArray(value)) return "json-array"
    if (typeof value === "object") return "json-object"
    if (typeof value === "string") return "string"
    if (typeof value === "number") return "number"
    if (typeof value === "boolean") return "boolean"
    return null
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

/**
 * Markdown / multi-line heuristic — same threshold the drill-in uses for
 * picking the long-form Lexical editor. Drives the markdown-style cell
 * rendering (italic content) so the cell still flags markdown without
 * needing a [markdown] chip or "N chars · N lines" header.
 */
function isMarkdownString(s: string): boolean {
    return s.length > 100 || s.includes("\n")
}

/**
 * Format a single value for inline rendering inside an array / object
 * preview. Strings stay bare (no surrounding quotes — drill-in doesn't
 * use them and consistency wins). Objects/arrays compress to `{…}` /
 * `[…]` so the parent's preview line stays short; the user expands via
 * the drill-in for the real shape.
 */
function formatInlineValue(value: unknown): string {
    if (value === null) return "null"
    if (value === undefined) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    if (Array.isArray(value)) return "[…]"
    if (typeof value === "object") return "{…}"
    return String(value)
}


/** Map a warning chip variant to its tooltip body. Mirrors describeWarning
 *  in ProposedDrillIn but tuned for the column/cell context (no per-row
 *  field name to interpolate). */
function describeCellWarning(variant: ChipVariant): {label: string; message: string} | null {
    switch (variant) {
        case "dotted-key":
            return {
                label: "Dotted key",
                message:
                    "This column is a literal key containing a dot. Templates resolve literal keys before nested paths, so {{key.with.dot}} reaches THIS column, not a nested traversal.",
            }
        case "collision":
            return {
                label: "Collision",
                message:
                    'Another column on this row collides with this one — a literal "a.b" key and a nested "a.b" path coexist. Literal-key wins at template resolution time; the nested form is silently shadowed.',
            }
        case "mixed":
            return {
                label: "Mixed types",
                message:
                    "This column mixes types across rows in the testset. Pick one and lock it via the schema, or accept that the column is intentionally heterogeneous.",
            }
        default:
            return null
    }
}

/** Aggregated Warning indicator for cells. Same role + tooltip pattern as
 *  FieldWarningsIndicator in the drill-in: collapses every applicable
 *  warning into a single icon button so dense cells stay readable.
 *  Exported so column headers can reuse the same widget — table consumers
 *  shouldn't need to re-implement the warning-stack-to-icon logic. */
export function CellWarningsIndicator({variants}: {variants: ChipVariant[]}) {
    const messages = variants
        .map((v) => describeCellWarning(v))
        .filter((m): m is {label: string; message: string} => m !== null)
    if (messages.length === 0) return null
    return (
        <Tooltip
            title={
                <div style={{display: "flex", flexDirection: "column", gap: 6}}>
                    {messages.map(({label, message}) => (
                        <div key={label} style={{lineHeight: 1.4}}>
                            <strong>{label}</strong>
                            <span> — {message}</span>
                        </div>
                    ))}
                </div>
            }
            color="#fff"
            styles={{
                body: {
                    color: "#051729",
                    border: "1px solid rgba(207, 19, 34, 0.35)",
                    fontSize: 12,
                    maxWidth: 360,
                },
            }}
        >
            <button
                type="button"
                aria-label={`${messages.length} warning${messages.length === 1 ? "" : "s"}`}
                style={styles.warnButton}
            >
                <Warning size={12} weight="fill" />
            </button>
        </Tooltip>
    )
}

/** Info indicator for stringified-JSON cells. Mirrors FieldInfoIndicator
 *  — small Info icon + tooltip explaining that the value is stored as a
 *  JSON string and that the parse? button switches the rendering. */
function CellStringifiedInfo() {
    return (
        <Tooltip
            title={
                <div style={{display: "flex", flexDirection: "column", gap: 4, lineHeight: 1.45}}>
                    <strong>Stored as a JSON string</strong>
                    <span>
                        The cell value is a string that happens to be valid JSON. Click parse? to
                        re-render as a parsed object — drill-in edits round-trip back into the
                        stringified storage on save.
                    </span>
                </div>
            }
            color="#fff"
            styles={{
                body: {
                    color: "#051729",
                    border: "1px solid rgba(5, 23, 41, 0.12)",
                    fontSize: 12,
                    maxWidth: 320,
                },
            }}
        >
            <button type="button" aria-label="Stored as a JSON string" style={styles.infoButton}>
                <Info size={12} />
            </button>
        </Tooltip>
    )
}

export function ProposedTableCell({
    value,
    columnType,
    omitParseAffordance,
    treatUndefinedAsMissing,
    chipMode = "all",
    maxLines = 10,
}: ProposedTableCellProps) {
    const showTypeChip = chipMode !== "none"
    // Suppress the cell's own type chip whenever the value's native type
    // matches the column's declared type — the header already carries it
    // and repetition reads as noise. When the value diverges (null in a
    // string column, etc.) the chip stays so the row-specific deviation
    // is visible.
    const cellType = inferCellNativeType(value)
    const matchesColumn = columnType !== undefined && cellType === columnType
    const renderTypeChip = (variant: ChipVariant) =>
        showTypeChip && !matchesColumn ? <TypeChip variant={variant} /> : null
    // Multi-line clamp style — rebuilt per render because line count is a
    // runtime prop. Combined with `whiteSpace: pre-wrap` so newlines in
    // markdown/JSON content visibly break, then the box clamps the total
    // visible lines and adds an ellipsis.
    const clampStyle = {
        display: "-webkit-box",
        WebkitLineClamp: maxLines,
        WebkitBoxOrient: "vertical" as const,
        overflow: "hidden" as const,
        whiteSpace: "pre-wrap" as const,
        wordBreak: "break-word" as const,
        flex: 1,
        minWidth: 0,
    }

    // missing key
    if (value === undefined && treatUndefinedAsMissing) {
        return <span style={styles.missing}>—</span>
    }

    // null
    if (value === null) {
        return (
            <span style={styles.cellInline}>
                {showTypeChip && !matchesColumn ? (
                    <TypeChip variant="null" />
                ) : (
                    <span style={styles.styledNull}>null</span>
                )}
            </span>
        )
    }

    // primitives — string/number/boolean. The chip area carries the
    // native type only; render hints (stringified / markdown) live in
    // the count + preview text.
    if (typeof value === "string") {
        // Stringified-JSON: render the raw string content (it IS a string
        // in storage — that's the whole point of the [string] type). The
        // parse? button + Info icon are the affordance to switch to a
        // parsed view; column-level parse omits both. No metadata header
        // — drill-in doesn't show one and the table shouldn't either.
        const parsed = tryParseStringifiedJson(value)
        if (parsed !== null) {
            return (
                <span style={styles.cellInline}>
                    {renderTypeChip("string")}
                    <span
                        style={{
                            ...styles.stringValue,
                            ...clampStyle,
                            ...(chipMode === "none" ? styles.styledStringified : null),
                        }}
                    >
                        {value}
                    </span>
                    {omitParseAffordance ? null : (
                        <>
                            <button type="button" style={styles.parseAffordance}>
                                parse?
                            </button>
                            <CellStringifiedInfo />
                        </>
                    )}
                </span>
            )
        }
        // Markdown / multi-line — render the content directly. Italic
        // telegraphs "this string renders as markdown"; line-clamp
        // handles overflow at the configured row height.
        if (isMarkdownString(value)) {
            return (
                <span style={styles.cellInline}>
                    {renderTypeChip("string")}
                    <span style={{...styles.markdownValue, ...clampStyle}}>{value}</span>
                </span>
            )
        }
        return (
            <span style={styles.cellInline}>
                <span style={{...styles.stringValue, ...clampStyle}}>{value}</span>
            </span>
        )
    }
    if (typeof value === "number") {
        return (
            <span style={styles.cellInline}>
                <span style={chipMode === "none" ? styles.styledNumber : styles.monoValue}>
                    {String(value)}
                </span>
            </span>
        )
    }
    if (typeof value === "boolean") {
        return (
            <span style={styles.cellInline}>
                <span style={chipMode === "none" ? styles.styledBoolean(value) : styles.monoValue}>
                    {String(value)}
                </span>
            </span>
        )
    }

    // object — render `key: value, key: value` inline, truncated by the
    // cell's overflow rule. Drill-in is where the user expands; the cell
    // just shows what's there at a glance, no `{ N props }` metadata.
    if (typeof value === "object" && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>
        const inline = Object.entries(obj)
            .map(([k, v]) => `${k}: ${formatInlineValue(v)}`)
            .join(", ")
        return (
            <span style={styles.cellInline}>
                {renderTypeChip("json-object")}
                <span style={{...styles.objectValue, ...clampStyle}}>{inline}</span>
            </span>
        )
    }

    // array — generic arrays render their items inline; chat-message
    // arrays delegate to production's ChatMessagesCellContent so the
    // table cell reads with the same role-coloured layout the drill-in
    // and observability views use; tool-calls render as `name(…)` since
    // the args belong in the drill-in not the cell.
    if (Array.isArray(value)) {
        if (isMessagesArray(value)) {
            return (
                <span style={styles.cellInline}>
                    {renderTypeChip("json-array")}
                    <span style={{...styles.arrayValue, ...clampStyle}}>
                        <ChatMessagesCellContent
                            value={value}
                            keyPrefix="cell"
                            maxLines={Math.max(1, Math.floor(maxLines / 2))}
                            maxTotalLines={maxLines}
                            truncate
                        />
                    </span>
                </span>
            )
        }
        if (isToolCallsArray(value)) {
            const inline = value
                .map((c) => {
                    const call = c as {function?: {name?: string; arguments?: unknown}}
                    const name = call.function?.name ?? "?"
                    return `${name}(…)`
                })
                .join(", ")
            return (
                <span style={styles.cellInline}>
                    {renderTypeChip("json-array")}
                    <span style={{...styles.arrayValue, ...clampStyle}}>{inline}</span>
                </span>
            )
        }
        const inline = value.map((v) => formatInlineValue(v)).join(", ")
        return (
            <span style={styles.cellInline}>
                {renderTypeChip("json-array")}
                <span style={{...styles.arrayValue, ...clampStyle}}>{inline}</span>
            </span>
        )
    }

    return <span>{String(value)}</span>
}

const styles = {
    // Single-line cell — flex so the value span can flex:1 and ellipsis
    // truncate when the table cell is narrower than the rendered content.
    cellInline: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        minWidth: 0,
    },
    // Single-line value — truncates with an ellipsis when the cell can't
    // hold the full content. Used for strings, objects-as-inline, and
    // arrays-as-inline so every variant reads at the same visual weight.
    stringValue: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "#0a3069",
        whiteSpace: "nowrap" as const,
        overflow: "hidden" as const,
        textOverflow: "ellipsis" as const,
        minWidth: 0,
        flex: 1,
    },
    monoValue: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "#051729",
    },
    objectValue: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "#051729",
        whiteSpace: "nowrap" as const,
        overflow: "hidden" as const,
        textOverflow: "ellipsis" as const,
        minWidth: 0,
        flex: 1,
    },
    arrayValue: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "#051729",
        whiteSpace: "nowrap" as const,
        overflow: "hidden" as const,
        textOverflow: "ellipsis" as const,
        minWidth: 0,
        flex: 1,
    },
    // Markdown content — italic to telegraph "this string renders as
    // markdown" without a [markdown] chip or "N chars · N lines" header.
    markdownValue: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "#051729",
        fontStyle: "italic" as const,
        whiteSpace: "nowrap" as const,
        overflow: "hidden" as const,
        textOverflow: "ellipsis" as const,
        minWidth: 0,
        flex: 1,
    },
    // Indicator buttons — same dimensions as fieldIndicatorButton in the
    // drill-in so cell + drill-in indicators look uniform across surfaces.
    warnButton: {
        background: "transparent",
        border: "none",
        cursor: "pointer" as const,
        padding: 0,
        display: "inline-flex",
        alignItems: "center" as const,
        justifyContent: "center" as const,
        height: 18,
        width: 18,
        verticalAlign: "middle" as const,
        color: "#cf1322",
    },
    infoButton: {
        background: "transparent",
        border: "none",
        cursor: "pointer" as const,
        padding: 0,
        display: "inline-flex",
        alignItems: "center" as const,
        justifyContent: "center" as const,
        height: 18,
        width: 18,
        verticalAlign: "middle" as const,
        color: "rgba(5, 23, 41, 0.45)",
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
