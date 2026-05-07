/**
 * PlaygroundVariableMap — gap-09 proposal made real.
 *
 * Renders the variable provenance + usage state for one execution item. Sits
 * above the inputs body in the kitchen-sink playground row so the team can see
 * the four variable states in the same visual surface that today only shows
 * "all inputs" identically:
 *
 *   used      — referenced by ≥1 prompt + on the testcase. Default rendering.
 *   unused    — on the testcase but NOT referenced by any prompt. Collapsed
 *               under a "Show unused" toggle to keep the visual budget small.
 *   draft     — referenced by ≥1 prompt but NOT on the testcase. Dashed
 *               border + [draft] chip. Lives only in the playground draft
 *               until the user explicitly syncs to the testset.
 *   chain     — used by SOME prompts in the chain but not all. Carries a
 *               "prompt 1, 3 of 4" badge showing where it lands.
 *
 * Compose-with notes:
 *   - gap-04 (union projection) — same shape applied to the testcase level.
 *   - gap-08 (variable validation) — symmetric edit-time check on the prompt
 *     surface; `draft` here mirrors gap-08's "referenced and missing" warning.
 *   - gap-07 (schema-aware form) — a per-testset schema disambiguates
 *     authored-vs-not without inference.
 *
 * This is a *mockup-only* component — no production wiring. It demonstrates
 * the visual + interaction shape so the gap-09 conversation can land on
 * concrete pixels.
 */

import {useState} from "react"

import {TypeChip, type ChipVariant} from "./TypeChip"

export type VariableUsageState = "used" | "unused" | "draft" | "chain"

export interface PlaygroundVariable {
    /** Variable name as it appears in the prompt template (`{{name}}`) */
    name: string
    /** Current value (used to infer the type chip) — undefined for `draft` */
    value: unknown
    /** Provenance + usage state */
    state: VariableUsageState
    /**
     * For `chain` state: which prompts (1-indexed) reference this variable.
     * E.g. [1, 3] for "prompt 1 + prompt 3". Total prompt count comes from
     * `chainLength` on the parent. Used to render "prompt 1, 3 of 4".
     */
    usedByPrompts?: number[]
}

interface PlaygroundVariableMapProps {
    variables: PlaygroundVariable[]
    /** Total prompts in the chain — used for the "of N" suffix on chain chips */
    chainLength?: number
    /** Default collapsed state for unused variables (default: true) */
    defaultUnusedCollapsed?: boolean
}

function inferTypeChip(value: unknown): {
    type: ChipVariant
    hint: ChipVariant | null
} {
    if (value === undefined) return {type: "string", hint: null}
    if (value === null) return {type: "null", hint: null}
    if (Array.isArray(value)) {
        if (
            value.length > 0 &&
            value.every((x) => x && typeof x === "object" && "role" in (x as object))
        ) {
            return {type: "json-array", hint: "messages"}
        }
        if (
            value.length > 0 &&
            value.every(
                (x) =>
                    x &&
                    typeof x === "object" &&
                    (x as {type?: unknown}).type === "function" &&
                    "function" in (x as object),
            )
        ) {
            return {type: "json-array", hint: "tool-calls"}
        }
        return {type: "json-array", hint: null}
    }
    if (typeof value === "object") return {type: "json-object", hint: null}
    if (typeof value === "number") return {type: "number", hint: null}
    if (typeof value === "boolean") return {type: "boolean", hint: null}
    if (typeof value === "string") {
        if (value[0] === "{" || value[0] === "[") {
            try {
                const parsed = JSON.parse(value)
                if (parsed && typeof parsed === "object") {
                    return {type: "string", hint: "stringified"}
                }
            } catch {
                /* not stringified */
            }
        }
        if (value.length > 100 || value.includes("\n")) {
            return {type: "string", hint: "markdown"}
        }
        return {type: "string", hint: null}
    }
    return {type: "string", hint: null}
}

function previewValue(value: unknown): string {
    if (value === undefined) return ""
    if (value === null) return "null"
    if (typeof value === "string") {
        const oneLine = value.replace(/\n+/g, " ").trim()
        return oneLine.length > 60 ? oneLine.slice(0, 60) + "…" : oneLine
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }
    if (Array.isArray(value)) return `[ ${value.length} items ]`
    if (typeof value === "object") {
        const keys = Object.keys(value as Record<string, unknown>)
        return `{ ${keys.length} props }`
    }
    return ""
}

export function PlaygroundVariableMap({
    variables,
    chainLength,
    defaultUnusedCollapsed = true,
}: PlaygroundVariableMapProps) {
    const [showUnused, setShowUnused] = useState(!defaultUnusedCollapsed)

    const used = variables.filter((v) => v.state === "used")
    const draft = variables.filter((v) => v.state === "draft")
    const chain = variables.filter((v) => v.state === "chain")
    const unused = variables.filter((v) => v.state === "unused")

    const total = variables.length

    return (
        <div style={styles.container}>
            <header style={styles.header}>
                <span style={styles.label}>Variable map</span>
                <span style={styles.summary}>
                    {total} variables · {used.length} used
                    {chain.length > 0 ? ` · ${chain.length} chain-scoped` : ""}
                    {draft.length > 0 ? ` · ${draft.length} draft` : ""}
                    {unused.length > 0 ? ` · ${unused.length} unused` : ""}
                </span>
            </header>

            {/* Active variables (used + chain + draft) — always visible */}
            <ul style={styles.list}>
                {[...used, ...chain, ...draft].map((v) => (
                    <VariableRow key={v.name} variable={v} chainLength={chainLength} />
                ))}
            </ul>

            {/* Unused variables — collapsed by default */}
            {unused.length > 0 ? (
                <div style={styles.unusedSection}>
                    <button
                        type="button"
                        style={styles.toggleButton}
                        onClick={() => setShowUnused((s) => !s)}
                    >
                        <span style={styles.toggleCaret}>{showUnused ? "▾" : "▸"}</span>
                        <span>
                            {showUnused ? "Hide" : "Show"} {unused.length} unused variable
                            {unused.length === 1 ? "" : "s"}
                        </span>
                        <span style={styles.toggleHint}>
                            on testcase but not referenced by any prompt
                        </span>
                    </button>
                    {showUnused ? (
                        <ul style={styles.list}>
                            {unused.map((v) => (
                                <VariableRow key={v.name} variable={v} chainLength={chainLength} />
                            ))}
                        </ul>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

interface VariableRowProps {
    variable: PlaygroundVariable
    chainLength?: number
}

function VariableRow({variable, chainLength}: VariableRowProps) {
    const {name, value, state, usedByPrompts} = variable
    const {type: typeChip, hint: renderHint} = inferTypeChip(value)
    const preview = previewValue(value)

    const isDraft = state === "draft"
    const isUnused = state === "unused"
    const isChain = state === "chain"

    const chainLabel =
        usedByPrompts && usedByPrompts.length > 0
            ? `prompt ${usedByPrompts.join(", ")}${chainLength ? ` of ${chainLength}` : ""}`
            : "chain"

    return (
        <li
            style={{
                ...styles.row,
                ...(isDraft ? styles.rowDraft : null),
                ...(isUnused ? styles.rowUnused : null),
            }}
        >
            <div style={styles.rowMain}>
                <TypeChip variant={typeChip} />
                {renderHint ? <TypeChip variant={renderHint} /> : null}
                <span style={styles.name}>{name}</span>
                {isChain ? <TypeChip variant="chain" label={chainLabel} /> : null}
                {isDraft ? <TypeChip variant="draft" /> : null}
                {isUnused ? <TypeChip variant="unused" /> : null}
            </div>
            <div style={styles.rowPreview}>
                {isDraft ? (
                    <span style={styles.draftHint}>not on testcase yet · syncs on save</span>
                ) : (
                    <span style={styles.previewText}>{preview}</span>
                )}
            </div>
        </li>
    )
}

const styles = {
    container: {
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 6,
        padding: "10px 12px",
        marginBottom: 12,
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 8,
    },
    label: {
        fontSize: 10,
        fontWeight: 600,
        color: "rgba(5, 23, 41, 0.55)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    summary: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.55)",
    },
    list: {
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column" as const,
        gap: 4,
    },
    row: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between" as const,
        gap: 12,
        padding: "4px 8px",
        borderRadius: 4,
        background: "rgba(5, 23, 41, 0.02)",
        border: "1px solid transparent",
        minHeight: 26,
    },
    rowDraft: {
        background: "#fff0f6",
        border: "1px dashed #c41d7f",
    },
    rowUnused: {
        background: "transparent",
        opacity: 0.65,
    },
    rowMain: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
    },
    rowPreview: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.55)",
        textAlign: "right" as const,
        overflow: "hidden" as const,
        textOverflow: "ellipsis" as const,
        whiteSpace: "nowrap" as const,
        maxWidth: 320,
    },
    name: {
        fontSize: 12,
        color: "#051729",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    previewText: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.65)",
    },
    draftHint: {
        fontSize: 11,
        fontStyle: "italic" as const,
        color: "#c41d7f",
    },
    unusedSection: {
        marginTop: 8,
        paddingTop: 8,
        borderTop: "1px dashed rgba(5, 23, 41, 0.08)",
    },
    toggleButton: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.65)",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: "2px 0",
        marginBottom: 6,
    },
    toggleCaret: {
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.45)",
    },
    toggleHint: {
        fontStyle: "italic" as const,
        color: "rgba(5, 23, 41, 0.45)",
        marginLeft: 4,
    },
}
