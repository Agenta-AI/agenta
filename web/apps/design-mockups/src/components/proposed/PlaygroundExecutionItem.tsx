/**
 * PlaygroundExecutionItem — proposed playground "run a testcase" card.
 *
 * Architectural insight (2026-05-04): a playground execution item is
 * structurally {inputs: ProposedDrillIn, output: rendered response} plus run
 * chrome. The "in place editing" the playground is named after comes from
 * re-using ProposedDrillIn's per-field widgets — Input for strings,
 * InputNumber for numbers, Switch for booleans, expandable structured edit
 * for objects/arrays, ChatMessageEditor for messages. We don't reinvent
 * inputs; we mount the drill-in.
 *
 * What this component owns vs delegates:
 *   - OWNS: header (testcase name, status pill, duration, Run button),
 *     evaluator strip, output rendering.
 *   - DELEGATES to ProposedDrillIn: inputs editor — every chip-mode + editable
 *     + autoExpand decision flows through unchanged.
 *
 * That means the playground inherits gap-01..06 for free: chips, type-styled
 * values, stringified-JSON detection, dot-key collision warnings, messages
 * + tool-call inline rendering — all the same code path the drawer uses.
 */

import {ArrowClockwise} from "@phosphor-icons/react"

import {
    ProposedDrillIn,
    type ChipRenderMode,
} from "./ProposedDrillIn"
import {TypeChip, type ChipVariant} from "./TypeChip"

interface InputField {
    name: string
    value: unknown
}

interface PlaygroundExecutionItemProps {
    testcaseLabel: string
    /** Each entry becomes a row in the embedded ProposedDrillIn */
    inputs: InputField[]
    /** Model response — string for plain text, object for tool-call or JSON output */
    output: unknown
    /** Optional evaluator scores rendered as inline chips below the output */
    evaluators?: {name: string; score: number; passed: boolean}[]
    /** Mock duration in ms */
    durationMs?: number
    /** Apply chip-mode (matches gap-01 toggle) */
    chipMode?: ChipRenderMode
    /** Read-only mode (matches gap-01 editable toggle) */
    editable?: boolean
}

/**
 * Classify a value into {type primitive, optional render hint}. The two
 * axes (per JP feedback 2026-05-05) — type chip says what it IS, render
 * hint chip says how it renders. Caller emits both.
 */
function classify(value: unknown): {type: ChipVariant; hint: ChipVariant | null} {
    if (value === null) return {type: "null", hint: null}
    if (Array.isArray(value)) {
        const isMessages =
            value.length > 0 &&
            value.every((x) => x && typeof x === "object" && "role" in (x as object))
        const isToolCalls =
            value.length > 0 &&
            value.every(
                (x) =>
                    x &&
                    typeof x === "object" &&
                    (x as {type?: unknown}).type === "function" &&
                    "function" in (x as object),
            )
        return {
            type: "json-array",
            hint: isMessages ? "messages" : isToolCalls ? "tool-calls" : null,
        }
    }
    if (typeof value === "object") return {type: "json-object", hint: null}
    if (typeof value === "number") return {type: "number", hint: null}
    if (typeof value === "boolean") return {type: "boolean", hint: null}
    if (typeof value === "string") {
        if (value[0] === "{" || value[0] === "[") {
            try {
                const p = JSON.parse(value)
                if (Array.isArray(p) || (p && typeof p === "object")) {
                    return {type: "string", hint: "stringified"}
                }
            } catch {
                // not stringified JSON
            }
        }
        if (value.length > 100 || value.includes("\n")) {
            return {type: "string", hint: "markdown"}
        }
    }
    return {type: "string", hint: null}
}

export function PlaygroundExecutionItem({
    testcaseLabel,
    inputs,
    output,
    evaluators,
    durationMs = 1240,
    chipMode = "all",
    editable = true,
}: PlaygroundExecutionItemProps) {
    // Hand the inputs array off to ProposedDrillIn as a flat object — it
    // handles caret + chip + widget per row exactly like the drawer does.
    const inputsData = inputs.reduce<Record<string, unknown>>((acc, f) => {
        acc[f.name] = f.value
        return acc
    }, {})

    const outputClassified = classify(output)
    const outputType = outputClassified.type
    const outputHint = outputClassified.hint
    const showOutputChip = chipMode !== "none"

    return (
        <div style={styles.card}>
            <header style={styles.header}>
                <div style={styles.headerLeft}>
                    <span style={styles.testcaseName}>{testcaseLabel}</span>
                    <span style={styles.statusPill}>completed</span>
                    <span style={styles.duration}>{durationMs}ms</span>
                </div>
                <div style={styles.headerRight}>
                    <button type="button" style={styles.runButton} disabled={!editable}>
                        <ArrowClockwise size={12} />
                        <span>Run</span>
                    </button>
                </div>
            </header>

            <section style={styles.section}>
                <div style={styles.sectionLabel}>Inputs</div>
                <ProposedDrillIn
                    data={inputsData}
                    rootTitle={testcaseLabel}
                    chipMode={chipMode}
                    editable={editable}
                    autoExpand={false}
                />
            </section>

            <section style={styles.section}>
                <div style={styles.outputHeader}>
                    <div style={styles.sectionLabel}>Output</div>
                    {showOutputChip && <TypeChip variant={outputType} />}
                    {showOutputChip && outputHint && (
                        <TypeChip variant={outputHint} />
                    )}
                </div>
                <div style={styles.outputBody}>
                    {/* Output is the model response. Editable here = "is the
                        playground in a state where the user could re-run after
                        editing inputs?" The output itself is a result, so it
                        renders read-only via ProposedDrillIn either way. */}
                    {outputType === "string" || outputType === "number" || outputType === "boolean" || outputType === "null" ? (
                        <span style={styles.outputText}>{String(output)}</span>
                    ) : (
                        <ProposedDrillIn
                            data={
                                outputType === "json-object"
                                    ? (output as Record<string, unknown>)
                                    : {result: output}
                            }
                            rootTitle="response"
                            chipMode={chipMode}
                            editable={false}
                            autoExpand
                        />
                    )}
                </div>
            </section>

            {evaluators && evaluators.length > 0 ? (
                <section style={styles.evalStrip}>
                    <span style={styles.sectionLabel}>Evaluators</span>
                    {evaluators.map((e) => (
                        <span
                            key={e.name}
                            style={{
                                ...styles.evalChip,
                                background: e.passed ? "#f6ffed" : "#fff2f0",
                                color: e.passed ? "#389e0d" : "#cf1322",
                                borderColor: e.passed
                                    ? "rgba(56, 158, 13, 0.3)"
                                    : "rgba(207, 19, 34, 0.3)",
                            }}
                        >
                            {e.name}: {e.score.toFixed(2)}
                        </span>
                    ))}
                </section>
            ) : null}
        </div>
    )
}

const styles = {
    card: {
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        overflow: "hidden" as const,
        display: "flex",
        flexDirection: "column" as const,
        boxShadow: "0 2px 8px rgba(5, 23, 41, 0.04)",
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between" as const,
        padding: "10px 14px",
        background: "#fafafa",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
        gap: 8,
    },
    headerLeft: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 0,
    },
    headerRight: {
        display: "flex",
        alignItems: "center",
        gap: 6,
    },
    testcaseName: {
        fontSize: 13,
        fontWeight: 600,
        color: "#051729",
    },
    statusPill: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        background: "#f6ffed",
        color: "#389e0d",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    duration: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.55)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    runButton: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontWeight: 600,
        padding: "4px 10px",
        borderRadius: 4,
        background: "#1677ff",
        color: "white",
        border: "none",
        cursor: "pointer",
    },
    section: {
        padding: "10px 14px",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
    },
    sectionLabel: {
        fontSize: 10,
        fontWeight: 600,
        color: "rgba(5, 23, 41, 0.55)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        display: "block",
        marginBottom: 8,
    },
    outputHeader: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
    },
    outputBody: {
        background: "#fafafa",
        border: "1px solid rgba(5, 23, 41, 0.06)",
        borderRadius: 6,
        padding: 10,
    },
    outputText: {
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.5,
    },
    evalStrip: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        background: "#fafafa",
        flexWrap: "wrap" as const,
    },
    evalChip: {
        fontSize: 10,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        padding: "2px 8px",
        borderRadius: 4,
        border: "1px solid",
        fontWeight: 600,
    },
}

export default PlaygroundExecutionItem
