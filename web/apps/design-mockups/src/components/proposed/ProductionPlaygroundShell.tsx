/**
 * ProductionPlaygroundShell — visual replica of the live Agenta playground.
 *
 * The mockup pages historically used a hand-rolled "Today" panel that drifted
 * from production over time. This component pins the design conversation to
 * what the user actually sees today: page header (Playground · New Evaluation
 * · Evaluator · Test set · Compare), Prompt Template panel on the left with
 * variant selector + view-mode dropdown + Commit, system + user message cards
 * with variable tokens highlighted, bottom toolbar (+ Message / + Tool /
 * Output type / Prompt Syntax), and Generations panel on the right with
 * testcase variable inputs and a Run button.
 *
 * Static visual — no interactive state. Structural reference for design
 * proposals so the team's response to "extremely complex" lands on the
 * actual surface they use, not a generic mock.
 */

import type {ReactNode} from "react"

import {MagicWand} from "@phosphor-icons/react"

interface PromptMessage {
    role: "System" | "User" | "Assistant"
    /**
     * Either a plain string (with `{{var}}` tokens detected and highlighted)
     * or a ReactNode for rich rendering (e.g. invalid-variable tooltips).
     */
    body: string | ReactNode
}

interface VariableInput {
    name: string
}

interface ProductionPlaygroundShellProps {
    promptVariantLabel?: string
    promptVariantStatus?: string
    modelLabel?: string
    promptSyntax?: "Curly" | "Mustache" | "JSONPath"
    outputType?: "Text" | "JSON" | "Markdown"
    messages?: PromptMessage[]
    testcaseLabel?: string
    inputs?: VariableInput[]
}

interface ProductionPromptTemplateProps {
    modelLabel?: string
    promptSyntax?: "Curly" | "Mustache" | "JSONPath"
    outputType?: "Text" | "JSON" | "Markdown"
    messages?: PromptMessage[]
    /** Optional banner rendered above the message cards (gap-08). */
    banner?: ReactNode
}

const TEMPLATE_TOKEN_RE = /\{\{([^}]+)\}\}/g

function renderTemplate(body: string): React.ReactNode[] {
    const parts: React.ReactNode[] = []
    let last = 0
    let m: RegExpExecArray | null
    while ((m = TEMPLATE_TOKEN_RE.exec(body))) {
        if (m.index > last) parts.push(body.slice(last, m.index))
        parts.push(
            <span key={m.index} style={styles.token}>
                {m[0]}
            </span>,
        )
        last = m.index + m[0].length
    }
    if (last < body.length) parts.push(body.slice(last))
    return parts
}

/**
 * Inline `{{var}}` token — same blue chip the production playground uses for
 * recognized variable references. Use inside a message body ReactNode.
 */
export function ValidVariable({children}: {children: ReactNode}) {
    return <span style={styles.token}>{children}</span>
}

/**
 * Inline `{{var}}` token in error state, with a red-bordered tooltip below.
 * Use inside a message body ReactNode for gap-08 Proposed rendering.
 */
export function InvalidVariable({
    variable,
    children,
}: {
    /** The unresolved variable path (e.g., "metadata.source") */
    variable: string
    children: ReactNode
}) {
    return (
        <span style={styles.invalidToken}>
            {children}
            <span style={styles.invalidTooltip}>
                <span style={styles.invalidTooltipTitle}>
                    Variable <code>{variable}</code> is not defined in your
                    dataset. You may encounter unexpected results.
                </span>
                <span style={styles.invalidTooltipActions}>
                    <button type="button" style={styles.invalidTooltipAction}>
                        Remove variable
                    </button>
                </span>
            </span>
        </span>
    )
}

/**
 * Production Prompt Template card — the inner content of the playground's
 * left panel. Reused by gap-08 so Today and Proposed render the *same* prompt
 * surface; Proposed only adds the banner + invalid-token tooltip on top.
 */
export function ProductionPromptTemplate({
    modelLabel = "gpt-4o-mini",
    promptSyntax = "Curly",
    outputType = "Text",
    messages = [
        {role: "System", body: "You are an expert in geography."},
        {
            role: "User",
            body: "What is the capital of {{inputs.country}} ? {{test}}",
        },
    ],
    banner,
}: ProductionPromptTemplateProps) {
    return (
        <div style={styles.promptTemplate}>
            <header style={styles.promptHeader}>
                <span style={styles.promptHeaderTitleRow}>
                    <span style={styles.promptCaret}>▾</span>
                    <span style={styles.promptHeaderTitle}>Prompt Template</span>
                </span>
                <span style={styles.promptHeaderRight}>
                    <button type="button" style={styles.iconButton}>
                        <MagicWand size={14} />
                    </button>
                    <button type="button" style={styles.modelSelector}>
                        {modelLabel} ▾
                    </button>
                </span>
            </header>

            {banner ? <div style={styles.banner}>{banner}</div> : null}

            {messages.map((msg, i) => (
                <div key={i} style={styles.messageCard}>
                    <header style={styles.messageHeader}>
                        <span style={styles.messageRole}>{msg.role}</span>
                        <span style={styles.messageRoleCaret}>↕</span>
                    </header>
                    <div style={styles.messageBody}>
                        {typeof msg.body === "string"
                            ? renderTemplate(msg.body)
                            : msg.body}
                    </div>
                </div>
            ))}

            <footer style={styles.messageToolbar}>
                <button type="button" style={styles.toolbarButton}>
                    + Message
                </button>
                <button type="button" style={styles.toolbarButton}>
                    + Tool
                </button>
                <button type="button" style={styles.toolbarSelect}>
                    Output type: {outputType} ▾
                </button>
                <button type="button" style={styles.toolbarSelect}>
                    Prompt Syntax: {promptSyntax} ▾
                </button>
            </footer>
        </div>
    )
}

export function ProductionPlaygroundShell({
    promptVariantLabel = "default",
    promptVariantStatus = "Draft",
    modelLabel = "gpt-4o-mini",
    promptSyntax = "Curly",
    outputType = "Text",
    messages = [
        {role: "System", body: "You are an expert in geography."},
        {
            role: "User",
            body: "What is the capital of {{inputs.country}} ? {{test}}",
        },
    ],
    testcaseLabel = "testcase 1",
    inputs = [{name: "country"}, {name: "test"}],
}: ProductionPlaygroundShellProps) {
    return (
        <div style={styles.shell}>
            <header style={styles.topBar}>
                <h1 style={styles.title}>Playground</h1>
                <div style={styles.topActions}>
                    <button type="button" style={styles.linkAction}>
                        <span style={styles.flaskIcon}>🧪</span>
                        New Evaluation
                    </button>
                    <button type="button" style={styles.dropdown}>
                        Evaluator ▾
                    </button>
                    <button type="button" style={styles.dropdown}>
                        Test set ▾
                    </button>
                    <button type="button" style={styles.primaryAction}>
                        + Compare
                    </button>
                </div>
            </header>

            <div style={styles.split}>
                <section style={styles.leftPanel}>
                    <header style={styles.panelHeader}>
                        <div style={styles.variantSelector}>
                            <span style={styles.variantName}>
                                {promptVariantLabel}
                            </span>
                            <span style={styles.variantVersion}>v2</span>
                            <span style={styles.variantStatus}>
                                ✏ {promptVariantStatus}
                            </span>
                            <span style={styles.variantDot} />
                        </div>
                        <div style={styles.panelHeaderRight}>
                            <button type="button" style={styles.viewToggle}>
                                Form ▾
                            </button>
                            <button type="button" style={styles.iconButton}>
                                ☁
                            </button>
                            <button type="button" style={styles.commitButton}>
                                ⌘ Commit
                            </button>
                            <button type="button" style={styles.iconButton}>
                                ⋮
                            </button>
                        </div>
                    </header>

                    <ProductionPromptTemplate
                        modelLabel={modelLabel}
                        promptSyntax={promptSyntax}
                        outputType={outputType}
                        messages={messages}
                    />
                </section>

                <section style={styles.rightPanel}>
                    <header style={styles.panelHeader}>
                        <div style={styles.generationsTitle}>
                            <span style={styles.generationsIcon}>≡</span>
                            <span style={styles.generationsName}>Generations</span>
                        </div>
                        <div style={styles.panelHeaderRight}>
                            <button type="button" style={styles.linkAction}>
                                Clear
                            </button>
                            <button type="button" style={styles.runAllButton}>
                                ▶ Run all
                            </button>
                        </div>
                    </header>

                    <div style={styles.testcase}>
                        <header style={styles.testcaseHeader}>
                            <span style={styles.testcaseLabelRow}>
                                <span style={styles.promptCaret}>▾</span>
                                <span style={styles.testcaseLabelChip}>
                                    🗐 {testcaseLabel}
                                </span>
                            </span>
                            <button type="button" style={styles.runButton}>
                                ▶ Run
                            </button>
                        </header>

                        {inputs.map((input) => (
                            <div key={input.name} style={styles.inputField}>
                                <label style={styles.inputLabel}>
                                    {input.name}
                                </label>
                                <div style={styles.inputPlaceholder}>
                                    Enter a value
                                </div>
                            </div>
                        ))}

                        <footer style={styles.testcaseFooter}>
                            <span style={styles.variantBadge}>
                                {promptVariantLabel}
                            </span>
                            <span style={styles.variantVersion}>v2</span>
                            <span style={styles.draftBadge}>draft</span>
                        </footer>
                    </div>
                </section>
            </div>
        </div>
    )
}

const styles = {
    shell: {
        display: "flex",
        flexDirection: "column" as const,
        background: "#f5f7fa",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        overflow: "hidden" as const,
        fontSize: 13,
        color: "#051729",
    },
    topBar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between" as const,
        padding: "10px 16px",
        background: "white",
        borderBottom: "1px solid rgba(5, 23, 41, 0.08)",
    },
    title: {
        fontSize: 16,
        fontWeight: 700,
        margin: 0,
        color: "#051729",
    },
    topActions: {
        display: "flex",
        alignItems: "center",
        gap: 8,
    },
    linkAction: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        fontSize: 13,
        color: "#051729",
        padding: "4px 8px",
    },
    flaskIcon: {
        fontSize: 14,
        opacity: 0.65,
    },
    dropdown: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 13,
        color: "#051729",
        padding: "5px 10px",
    },
    primaryAction: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
        color: "#051729",
        padding: "5px 12px",
    },
    split: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: 0,
        background: "white",
    },
    leftPanel: {
        display: "flex",
        flexDirection: "column" as const,
        borderRight: "1px solid rgba(5, 23, 41, 0.08)",
        background: "white",
    },
    rightPanel: {
        display: "flex",
        flexDirection: "column" as const,
        background: "white",
    },
    panelHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between" as const,
        padding: "8px 14px",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
        background: "white",
        gap: 8,
    },
    variantSelector: {
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "3px 10px",
        background: "rgba(5, 23, 41, 0.04)",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 6,
        fontSize: 13,
    },
    variantName: {
        fontWeight: 500,
    },
    variantVersion: {
        fontSize: 11,
        padding: "1px 6px",
        background: "rgba(5, 23, 41, 0.06)",
        borderRadius: 3,
        color: "rgba(5, 23, 41, 0.65)",
    },
    variantStatus: {
        fontSize: 11,
        padding: "1px 6px",
        background: "#fff7e6",
        color: "#d46b08",
        borderRadius: 3,
    },
    variantDot: {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#722ed1",
    },
    panelHeaderRight: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
    },
    viewToggle: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 10px",
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 6,
        fontSize: 13,
        cursor: "pointer",
    },
    iconButton: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center" as const,
        width: 28,
        height: 28,
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 13,
        color: "rgba(5, 23, 41, 0.65)",
    },
    commitButton: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 12px",
        background: "#051729",
        color: "white",
        border: "none",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
    },
    promptTemplate: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 10,
        padding: "12px 14px",
    },
    banner: {
        padding: "8px 12px",
        background: "#f0f9ff",
        border: "1px solid rgba(22, 119, 255, 0.25)",
        borderRadius: 6,
        fontSize: 12,
        color: "#0958d9",
        lineHeight: 1.5,
    },
    invalidToken: {
        position: "relative" as const,
        display: "inline-block",
        padding: "0 6px",
        background: "rgba(207, 19, 34, 0.06)",
        color: "#cf1322",
        borderRadius: 3,
        border: "1px dashed #cf1322",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
    },
    invalidTooltip: {
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
        whiteSpace: "normal" as const,
        textAlign: "left" as const,
        color: "#051729",
        fontFamily: "inherit",
    },
    invalidTooltipTitle: {
        fontSize: 12,
        lineHeight: 1.5,
    },
    invalidTooltipActions: {
        display: "flex",
        gap: 8,
    },
    invalidTooltipAction: {
        fontSize: 11,
        fontWeight: 500,
        padding: "3px 10px",
        borderRadius: 4,
        background: "white",
        color: "#cf1322",
        border: "1px solid #cf1322",
        cursor: "pointer" as const,
    },
    promptHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between" as const,
        gap: 8,
    },
    promptHeaderTitleRow: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
    },
    promptCaret: {
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.55)",
    },
    promptHeaderTitle: {
        fontSize: 14,
        fontWeight: 600,
    },
    promptHeaderRight: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
    },
    modelSelector: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 10px",
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 6,
        fontSize: 12,
        cursor: "pointer",
    },
    messageCard: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 6,
        padding: "10px 12px",
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 6,
    },
    messageHeader: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
    },
    messageRole: {
        fontSize: 12,
        fontWeight: 600,
        color: "#051729",
    },
    messageRoleCaret: {
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.45)",
    },
    messageBody: {
        fontSize: 13,
        lineHeight: 1.5,
        color: "#051729",
    },
    token: {
        display: "inline-block",
        padding: "0 6px",
        background: "#e6f4ff",
        color: "#1677ff",
        borderRadius: 3,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
    },
    messageToolbar: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap" as const,
        gap: 6,
        marginTop: 2,
    },
    toolbarButton: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 6,
        fontSize: 12,
        cursor: "pointer",
    },
    toolbarSelect: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 6,
        fontSize: 12,
        cursor: "pointer",
    },
    generationsTitle: {
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
    },
    generationsIcon: {
        fontSize: 14,
        color: "rgba(5, 23, 41, 0.55)",
    },
    generationsName: {
        fontSize: 14,
        fontWeight: 600,
    },
    runAllButton: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 14px",
        background: "#051729",
        color: "white",
        border: "none",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
    },
    testcase: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 10,
        padding: "12px 14px",
    },
    testcaseHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between" as const,
        gap: 8,
    },
    testcaseLabelRow: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
    },
    testcaseLabelChip: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 10px",
        background: "rgba(5, 23, 41, 0.04)",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 6,
        fontSize: 12,
    },
    runButton: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 12px",
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 6,
        fontSize: 12,
        cursor: "pointer",
    },
    inputField: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 6,
        padding: "10px 12px",
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 6,
    },
    inputLabel: {
        fontSize: 12,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "#1677ff",
    },
    inputPlaceholder: {
        fontSize: 13,
        color: "rgba(5, 23, 41, 0.35)",
    },
    testcaseFooter: {
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        background: "rgba(5, 23, 41, 0.02)",
        border: "1px solid rgba(5, 23, 41, 0.06)",
        borderRadius: 6,
    },
    variantBadge: {
        fontSize: 12,
        fontWeight: 500,
        color: "#051729",
    },
    draftBadge: {
        fontSize: 11,
        padding: "1px 8px",
        background: "#fff7e6",
        color: "#d46b08",
        borderRadius: 3,
    },
}
