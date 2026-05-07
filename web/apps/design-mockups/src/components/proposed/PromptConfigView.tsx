/**
 * PromptConfigView — playground prompt config card.
 *
 * Surfaces the prompt template(s) the user is editing alongside the variable
 * references they pull in. Mounted above the execution-item compare grid so
 * the playground reads as "prompt → variables it needs → values fed in"
 * instead of "wall of testcase data with mystery variable references."
 *
 * Responds to Mahmoud's 2026-05-05 feedback that the playground execution
 * item felt extremely complex, especially for SMEs (subject-matter experts):
 * the config view gives newcomers a clear contract — "this prompt needs
 * country and messages; chain step 2 also needs geo." Without it, the user
 * has to reverse-engineer which variables matter from the inputs panel.
 *
 * Mockup-only — production playground has its own prompt editor; this
 * component visualizes the same idea in the design space.
 */

import {Fragment} from "react"

import {TypeChip} from "./TypeChip"

export interface PromptConfig {
    /** Step number in the chain (1-indexed) */
    step: number
    /** Human-readable name (e.g. "Geography lookup", "Format response") */
    name: string
    /** Prompt template body — `{{var}}` references will render highlighted */
    template: string
    /**
     * Variables this prompt references. `state` mirrors the gap-09 vocabulary
     * so the config view + variable map stay aligned:
     *   - `resolved` — variable exists on the testcase, ready to substitute
     *   - `draft`    — referenced but not on testcase yet (gap-09)
     */
    variables: {name: string; state: "resolved" | "draft"}[]
}

interface PromptConfigViewProps {
    prompts: PromptConfig[]
}

const TEMPLATE_TOKEN_RE = /\{\{([^}]+)\}\}/g

function renderTemplate(template: string): React.ReactNode[] {
    const parts: React.ReactNode[] = []
    let last = 0
    let match: RegExpExecArray | null
    while ((match = TEMPLATE_TOKEN_RE.exec(template))) {
        if (match.index > last) parts.push(template.slice(last, match.index))
        parts.push(
            <span key={match.index} style={styles.token}>
                {match[0]}
            </span>,
        )
        last = match.index + match[0].length
    }
    if (last < template.length) parts.push(template.slice(last))
    return parts
}

export function PromptConfigView({prompts}: PromptConfigViewProps) {
    const chainLength = prompts.length
    return (
        <div style={styles.container}>
            <header style={styles.header}>
                <span style={styles.label}>Prompt config</span>
                <span style={styles.summary}>
                    {chainLength === 1 ? "single prompt" : `${chainLength}-step chain`}
                </span>
            </header>
            <ol style={styles.list}>
                {prompts.map((p) => (
                    <li key={p.step} style={styles.card}>
                        <header style={styles.cardHeader}>
                            <span style={styles.step}>
                                {p.step} of {chainLength}
                            </span>
                            <span style={styles.cardName}>{p.name}</span>
                        </header>
                        <pre style={styles.template}>{renderTemplate(p.template)}</pre>
                        <footer style={styles.cardFooter}>
                            <span style={styles.varsLabel}>Variables:</span>
                            {p.variables.length === 0 ? (
                                <span style={styles.varsEmpty}>none</span>
                            ) : (
                                p.variables.map((v, i) => (
                                    <Fragment key={v.name}>
                                        <span style={styles.varToken}>
                                            <span style={styles.varName}>{`{{${v.name}}}`}</span>
                                            {v.state === "draft" ? (
                                                <TypeChip variant="draft" />
                                            ) : null}
                                        </span>
                                        {i < p.variables.length - 1 ? (
                                            <span style={styles.varSep}>·</span>
                                        ) : null}
                                    </Fragment>
                                ))
                            )}
                        </footer>
                    </li>
                ))}
            </ol>
        </div>
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
        gap: 8,
    },
    card: {
        background: "rgba(5, 23, 41, 0.02)",
        border: "1px solid rgba(5, 23, 41, 0.06)",
        borderRadius: 4,
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column" as const,
        gap: 6,
    },
    cardHeader: {
        display: "flex",
        alignItems: "center",
        gap: 8,
    },
    step: {
        fontSize: 10,
        fontWeight: 600,
        color: "rgba(5, 23, 41, 0.55)",
        background: "rgba(5, 23, 41, 0.06)",
        padding: "1px 6px",
        borderRadius: 3,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        letterSpacing: "0.04em",
    },
    cardName: {
        fontSize: 12,
        fontWeight: 600,
        color: "#051729",
    },
    template: {
        margin: 0,
        padding: "8px 10px",
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 4,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.6,
        color: "#051729",
        whiteSpace: "pre-wrap" as const,
        wordBreak: "break-word" as const,
    },
    token: {
        background: "#e6f4ff",
        color: "#1677ff",
        padding: "0 4px",
        borderRadius: 3,
        fontWeight: 500,
    },
    cardFooter: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap" as const,
        gap: 6,
    },
    varsLabel: {
        fontSize: 10,
        fontWeight: 600,
        color: "rgba(5, 23, 41, 0.55)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    varsEmpty: {
        fontSize: 11,
        fontStyle: "italic" as const,
        color: "rgba(5, 23, 41, 0.45)",
    },
    varToken: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
    },
    varName: {
        fontSize: 11,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "#1677ff",
    },
    varSep: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.3)",
    },
}
