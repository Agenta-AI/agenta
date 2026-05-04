/**
 * PromptVariableValidation — gap-08 mock of the playground prompt surface
 * with edit-time variable validation against the attached testset's schema.
 *
 * Two surfaces in one component:
 *   - dataset-attach banner (proactive: lists canonical references when a
 *     testset is wired in but the prompt doesn't reference any variables)
 *   - per-variable tooltip (reactive: when a referenced path doesn't exist
 *     in the dataset, surface a red-bordered tooltip with the specific
 *     variable name + a Remove-variable quick-action)
 *
 * Static mock for the design exploration. Real implementation reads from
 * the per-testset schema entity (gap-07) and runs the variable check at
 * edit time, not run time.
 */

import type {ReactNode} from "react"

interface PromptVariableValidationProps {
    /** Name of the attached testset for the dataset pill */
    datasetName: string
    /** When provided, renders an inline blue banner above the messages */
    banner?: ReactNode
    /** Message rows; body can include inline variable spans */
    messages: {
        role: "system" | "user" | "assistant"
        body: ReactNode
    }[]
}

export function PromptVariableValidation({
    datasetName,
    banner,
    messages,
}: PromptVariableValidationProps) {
    return (
        <div style={styles.frame}>
            <header style={styles.frameHeader}>
                <span style={styles.modelPill}>Claude 4.5 Sonnet</span>
                <span style={styles.datasetPill}>Dataset · {datasetName}</span>
                <button type="button" style={styles.runButton}>
                    ▶ Run
                </button>
            </header>
            {banner ? <div style={styles.banner}>{banner}</div> : null}
            <div style={styles.messages}>
                {messages.map((m, i) => (
                    <div key={i} style={styles.messageRow}>
                        <span style={styles.roleTag}>{m.role}</span>
                        <div style={styles.messageBody}>{m.body}</div>
                    </div>
                ))}
                <div style={styles.toolbar}>
                    <button type="button" style={styles.toolbarButton}>
                        + Message
                    </button>
                    <button type="button" style={styles.toolbarButton}>
                        Tools
                    </button>
                    <button type="button" style={styles.toolbarButton}>
                        Variables
                    </button>
                </div>
            </div>
        </div>
    )
}

/**
 * Inline span for a *valid* variable reference inside a message body.
 * Use inside `messages[].body` JSX.
 */
export function ValidVariable({children}: {children: ReactNode}) {
    return <span style={styles.var}>{children}</span>
}

/**
 * Inline span for an *invalid* variable reference + tooltip popover.
 * Use inside `messages[].body` JSX.
 */
export function InvalidVariable({
    variable,
    children,
}: {
    /** The unresolved variable name (e.g., "metadata.source") */
    variable: string
    children: ReactNode
}) {
    return (
        <span style={styles.varInvalid}>
            {children}
            <span style={styles.tooltip}>
                <span style={styles.tooltipTitle}>
                    Variable <code>{variable}</code> is not defined in your
                    dataset. You may encounter unexpected results.
                </span>
                <span style={styles.tooltipActions}>
                    <button type="button" style={styles.tooltipAction}>
                        Remove variable
                    </button>
                </span>
            </span>
        </span>
    )
}

const styles = {
    frame: {
        background: "white",
        borderRadius: 8,
        border: "1px solid rgba(5, 23, 41, 0.08)",
        overflow: "hidden" as const,
        display: "flex",
        flexDirection: "column" as const,
    },
    frameHeader: {
        padding: "10px 14px",
        borderBottom: "1px solid rgba(5, 23, 41, 0.08)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap" as const,
    },
    modelPill: {
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        background: "rgba(5, 23, 41, 0.06)",
        color: "#051729",
    },
    datasetPill: {
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 4,
        background: "#f0f9ff",
        color: "#1677ff",
    },
    runButton: {
        marginLeft: "auto",
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 10px",
        borderRadius: 4,
        background: "#1677ff",
        color: "white",
        border: "none",
        cursor: "pointer",
    },
    banner: {
        padding: "8px 14px",
        background: "#f0f9ff",
        borderBottom: "1px solid rgba(22, 119, 255, 0.2)",
        fontSize: 12,
        color: "#0958d9",
        lineHeight: 1.5,
    },
    messages: {
        padding: 12,
        display: "flex",
        flexDirection: "column" as const,
        gap: 8,
    },
    messageRow: {
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "8px 10px",
        background: "#fafafa",
        borderRadius: 6,
        border: "1px solid rgba(5, 23, 41, 0.06)",
    },
    roleTag: {
        flexShrink: 0,
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 3,
        background: "white",
        color: "rgba(5, 23, 41, 0.65)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    messageBody: {
        flex: 1,
        fontSize: 13,
        lineHeight: 1.5,
        color: "#051729",
        position: "relative" as const,
    },
    var: {
        display: "inline-block",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
        padding: "1px 6px",
        borderRadius: 3,
        background: "rgba(22, 119, 255, 0.08)",
        color: "#1677ff",
    },
    varInvalid: {
        position: "relative" as const,
        display: "inline-block",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
        padding: "1px 6px",
        borderRadius: 3,
        background: "rgba(207, 19, 34, 0.06)",
        color: "#cf1322",
        border: "1px dashed #cf1322",
    },
    tooltip: {
        position: "absolute" as const,
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 2,
        minWidth: 280,
        maxWidth: 360,
        padding: 10,
        background: "white",
        border: "1px solid #cf1322",
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(207, 19, 34, 0.12)",
        display: "flex",
        flexDirection: "column" as const,
        gap: 8,
    },
    tooltipTitle: {
        fontSize: 12,
        lineHeight: 1.5,
        color: "#051729",
        fontFamily: "inherit",
        whiteSpace: "normal" as const,
    },
    tooltipActions: {
        display: "flex",
        gap: 8,
    },
    tooltipAction: {
        fontSize: 11,
        fontWeight: 500,
        padding: "3px 10px",
        borderRadius: 4,
        background: "white",
        color: "#cf1322",
        border: "1px solid #cf1322",
        cursor: "pointer",
    },
    toolbar: {
        display: "flex",
        gap: 6,
        marginTop: 4,
    },
    toolbarButton: {
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: 4,
        background: "white",
        color: "rgba(5, 23, 41, 0.65)",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        cursor: "pointer",
    },
}
