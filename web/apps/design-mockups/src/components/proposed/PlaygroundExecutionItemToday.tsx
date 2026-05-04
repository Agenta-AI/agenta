/**
 * PlaygroundExecutionItemToday — faithful mock of production's current
 * playground execution item, used as the "Today" baseline alongside the
 * proposed `PlaygroundExecutionItem`. Mirrors what users actually see in
 * production today: per-input card with mono blue field name, "Enter a value"
 * placeholder, variant pill (default v2 + draft tag), and an output card with
 * the "No output yet" empty state.
 *
 * Static mock — no chips, no type styling, no status pills, no duration, no
 * evaluator strip. Those are deliberately absent because production doesn't
 * have them; the Proposed version next to this one shows what could be added.
 */

import {useId} from "react"

import {Play} from "@phosphor-icons/react"
import {Input} from "antd"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {MarkdownToggleButton} from "@agenta/ui"

interface InputField {
    name: string
    /** Optional pre-filled value (default: empty placeholder state) */
    value?: string
}

function isLongFormString(value: string): boolean {
    return value.length > 100 || value.includes("\n")
}

interface PlaygroundExecutionItemTodayProps {
    testcaseLabel: string
    inputs: InputField[]
    /** When provided, renders the output card; otherwise shows "No output yet" */
    output?: string
    variantName?: string
    isDraft?: boolean
}

/**
 * Per-input card for the Today panel. Picks the editor based on content:
 *   - Short single-line strings → antd `<Input.TextArea>` borderless. This
 *     is what production currently renders for short inputs.
 *   - Long-form / multi-line / markdown → production Lexical `SharedEditor`
 *     wrapped in `EditorProvider`, with markdown toggle enabled. This is
 *     what production already does for long-form text fields — the Today
 *     panel mirrors it so the comparison with Proposed and Alt is honest.
 */
function TodayInputCard({field}: {field: InputField}) {
    const editorId = useId()
    const value = field.value ?? ""
    const longForm = isLongFormString(value)
    return (
        <div style={styles.inputCard}>
            <div style={styles.inputName}>{field.name}</div>
            {longForm ? (
                <EditorProvider
                    key={`${editorId}-text-provider`}
                    id={editorId}
                    initialValue={value}
                    showToolbar={false}
                    enableTokens={false}
                >
                    <div style={styles.longFormToolbar}>
                        <span style={styles.longFormHint}>Markdown</span>
                        <MarkdownToggleButton id={editorId} />
                    </div>
                    <SharedEditor
                        id={editorId}
                        initialValue={value}
                        editorType="borderless"
                        className="overflow-visible"
                        disableDebounce
                        noProvider
                    />
                </EditorProvider>
            ) : (
                <Input.TextArea
                    defaultValue={field.value}
                    placeholder="Enter a value"
                    autoSize={{minRows: 1, maxRows: 6}}
                    variant="borderless"
                    style={styles.inputTextarea}
                />
            )}
        </div>
    )
}

export function PlaygroundExecutionItemToday({
    testcaseLabel,
    inputs,
    output,
    variantName = "default v2",
    isDraft = true,
}: PlaygroundExecutionItemTodayProps) {
    return (
        <div style={styles.card}>
            <header style={styles.header}>
                <div style={styles.headerLeft}>
                    <span style={styles.caretButton}>▾</span>
                    <span style={styles.testcasePill}>
                        <span style={styles.testcaseIcon}>▦</span>
                        {testcaseLabel}
                    </span>
                </div>
                <button type="button" style={styles.runButton}>
                    <Play size={12} weight="fill" />
                    <span>Run</span>
                </button>
            </header>

            <div style={styles.body}>
                {inputs.map((field) => (
                    <TodayInputCard key={field.name} field={field} />
                ))}

                <div style={styles.variantStrip}>
                    <span style={styles.variantPill}>
                        {variantName.split(" ")[0]}{" "}
                        <span style={styles.variantVersion}>
                            {variantName.split(" ").slice(1).join(" ")}
                        </span>
                    </span>
                    {isDraft ? <span style={styles.draftPill}>draft</span> : null}
                </div>

                <div style={styles.outputCard}>
                    {output ? (
                        <div style={styles.outputText}>{output}</div>
                    ) : (
                        <div style={styles.outputEmpty}>
                            <Play size={14} style={styles.outputPlayIcon} />
                            <div>
                                <div style={styles.outputEmptyTitle}>No output yet</div>
                                <div style={styles.outputEmptyHint}>
                                    Click Run (Ctrl+Enter / ⌘+Enter) to generate output.
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
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
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between" as const,
        padding: "10px 14px",
        background: "white",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
        gap: 8,
    },
    headerLeft: {
        display: "flex",
        alignItems: "center",
        gap: 8,
    },
    caretButton: {
        color: "rgba(5, 23, 41, 0.5)",
        fontSize: 12,
        cursor: "pointer",
    },
    testcasePill: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 500,
        padding: "2px 10px",
        borderRadius: 4,
        background: "rgba(5, 23, 41, 0.05)",
        color: "#051729",
    },
    testcaseIcon: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.55)",
    },
    runButton: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        padding: "4px 10px",
        borderRadius: 6,
        background: "white",
        color: "#051729",
        border: "1px solid rgba(5, 23, 41, 0.16)",
        cursor: "pointer",
    },
    body: {
        padding: 12,
        display: "flex",
        flexDirection: "column" as const,
        gap: 10,
    },
    inputCard: {
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 6,
        padding: "10px 12px",
        background: "white",
    },
    inputName: {
        fontSize: 13,
        fontWeight: 600,
        color: "#1677ff",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        marginBottom: 6,
    },
    inputTextarea: {
        fontSize: 12,
        lineHeight: 1.5,
        padding: 0,
        color: "#051729",
        background: "transparent",
    },
    longFormToolbar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between" as const,
        padding: "2px 0 4px",
        borderBottom: "1px dashed rgba(5, 23, 41, 0.08)",
        marginBottom: 6,
    },
    longFormHint: {
        fontSize: 10,
        fontWeight: 600,
        color: "rgba(5, 23, 41, 0.55)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
    },
    variantStrip: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginTop: 4,
    },
    variantPill: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 12,
        fontWeight: 500,
        padding: "3px 10px",
        borderRadius: 4,
        background: "rgba(5, 23, 41, 0.06)",
        color: "#051729",
    },
    variantVersion: {
        color: "rgba(5, 23, 41, 0.55)",
    },
    draftPill: {
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 4,
        background: "#fffbe6",
        color: "#d46b08",
    },
    outputCard: {
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 6,
        padding: 14,
        background: "white",
    },
    outputText: {
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.5,
    },
    outputEmpty: {
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
    },
    outputPlayIcon: {
        color: "rgba(5, 23, 41, 0.45)",
        marginTop: 2,
        flexShrink: 0,
    },
    outputEmptyTitle: {
        fontSize: 13,
        color: "rgba(5, 23, 41, 0.55)",
        marginBottom: 2,
    },
    outputEmptyHint: {
        fontSize: 12,
        color: "rgba(5, 23, 41, 0.45)",
    },
}

export default PlaygroundExecutionItemToday
