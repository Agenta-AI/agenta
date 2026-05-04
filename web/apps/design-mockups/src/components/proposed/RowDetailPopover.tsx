/**
 * RowDetailPopover — Mode 3 stop-gap demo.
 *
 * Surfaced 2026-05-04 by competitive analysis §13. Braintrust has THREE
 * rendering modes for the same row data:
 *   Mode 1 — truncated single-line in the table cell (compact rows)
 *   Mode 2 — multi-line YAML preview in the table cell (tall rows)
 *   Mode 3 — full pretty-JSON popover on row click (no truncation)
 *
 * Mode 3 is a near-zero-cost stop-gap that buys 80% of "let me see the whole
 * thing without editing" while gap-07's schema-aware form is being built.
 *
 * This component is the mockup of Mode 3: a lightbox/modal-style popover with
 * a "View full JSON" trigger button + a pretty-printed, syntax-coloured,
 * scrollable read-only JSON view of the entire row data. Real implementation
 * would live in OSS as a row-action on the testset table + drill-in surface.
 */

import {useState, type ReactNode} from "react"

interface RowDetailPopoverProps {
    label: string
    data: unknown
    /** Optional trigger label override */
    triggerLabel?: string
    /** Optional inline trigger renderer; defaults to a small button */
    renderTrigger?: (open: () => void) => ReactNode
}

export function RowDetailPopover({
    label,
    data,
    triggerLabel = "View full JSON",
    renderTrigger,
}: RowDetailPopoverProps) {
    const [open, setOpen] = useState(false)

    const trigger = renderTrigger ? (
        renderTrigger(() => setOpen(true))
    ) : (
        <button type="button" style={styles.triggerButton} onClick={() => setOpen(true)}>
            {triggerLabel}
        </button>
    )

    return (
        <>
            {trigger}
            {open ? (
                <div style={styles.scrim} onClick={() => setOpen(false)}>
                    <div
                        style={styles.modal}
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-label={`Full JSON for ${label}`}
                    >
                        <header style={styles.header}>
                            <span style={styles.headerLeft}>
                                <span style={styles.modeChip}>Mode 3 · stop-gap</span>
                                <span style={styles.title}>{label}</span>
                            </span>
                            <button
                                type="button"
                                style={styles.closeButton}
                                onClick={() => setOpen(false)}
                                aria-label="Close"
                            >
                                ✕
                            </button>
                        </header>
                        <div style={styles.body}>
                            <PrettyJson value={data} />
                        </div>
                        <footer style={styles.footer}>
                            <span style={styles.footerNote}>
                                Read-only. Edit via the drill-in (gap-03) or the
                                schema-aware form (gap-07).
                            </span>
                        </footer>
                    </div>
                </div>
            ) : null}
        </>
    )
}

interface PrettyJsonProps {
    value: unknown
}

function PrettyJson({value}: PrettyJsonProps) {
    const text = JSON.stringify(value, null, 2)
    return (
        <pre style={styles.pre}>
            {text.split("\n").map((line, idx) => (
                <Line key={idx} text={line} />
            ))}
        </pre>
    )
}

function Line({text}: {text: string}) {
    // Minimal syntax highlighting: keys, strings, numbers, booleans, null
    // Tokenize without regex magic — keep this readable.
    const elements: ReactNode[] = []
    let cursor = 0
    while (cursor < text.length) {
        const c = text[cursor]
        // Whitespace + structural punctuation
        if (
            c === " " ||
            c === "\t" ||
            c === "{" ||
            c === "}" ||
            c === "[" ||
            c === "]" ||
            c === "," ||
            c === ":"
        ) {
            elements.push(c)
            cursor++
            continue
        }
        // Strings
        if (c === '"') {
            let end = cursor + 1
            while (end < text.length) {
                if (text[end] === "\\") {
                    end += 2
                    continue
                }
                if (text[end] === '"') break
                end++
            }
            const literal = text.slice(cursor, end + 1)
            // Key vs value: a string followed by `:` is a key
            const next = text[end + 1]
            const isKey = next === ":"
            elements.push(
                <span
                    key={cursor}
                    style={isKey ? syntax.key : syntax.string}
                >
                    {literal}
                </span>,
            )
            cursor = end + 1
            continue
        }
        // Numbers / booleans / null
        if (c === "-" || (c >= "0" && c <= "9")) {
            let end = cursor + 1
            while (end < text.length && /[0-9.eE+-]/.test(text[end])) end++
            elements.push(
                <span key={cursor} style={syntax.number}>
                    {text.slice(cursor, end)}
                </span>,
            )
            cursor = end
            continue
        }
        if (text.slice(cursor, cursor + 4) === "true") {
            elements.push(
                <span key={cursor} style={syntax.boolean}>
                    true
                </span>,
            )
            cursor += 4
            continue
        }
        if (text.slice(cursor, cursor + 5) === "false") {
            elements.push(
                <span key={cursor} style={syntax.boolean}>
                    false
                </span>,
            )
            cursor += 5
            continue
        }
        if (text.slice(cursor, cursor + 4) === "null") {
            elements.push(
                <span key={cursor} style={syntax.null}>
                    null
                </span>,
            )
            cursor += 4
            continue
        }
        // Fallback
        elements.push(c)
        cursor++
    }
    return <div style={styles.line}>{elements}</div>
}

const syntax = {
    key: {color: "#1677ff"},
    string: {color: "#389e0d"},
    number: {color: "#722ed1"},
    boolean: {color: "#d46b08"},
    null: {color: "rgba(5, 23, 41, 0.55)"},
}

const styles = {
    triggerButton: {
        fontSize: 11,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        padding: "2px 8px",
        borderRadius: 4,
        background: "white",
        color: "#1677ff",
        border: "1px solid rgba(22, 119, 255, 0.4)",
        cursor: "pointer",
    },
    scrim: {
        position: "fixed" as const,
        inset: 0,
        background: "rgba(5, 23, 41, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
    },
    modal: {
        width: "min(720px, 90vw)",
        maxHeight: "80vh",
        background: "white",
        borderRadius: 8,
        border: "1px solid rgba(5, 23, 41, 0.12)",
        boxShadow: "0 16px 48px rgba(5, 23, 41, 0.16)",
        display: "flex",
        flexDirection: "column" as const,
        overflow: "hidden",
    },
    header: {
        padding: "10px 14px",
        borderBottom: "1px solid rgba(5, 23, 41, 0.08)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexShrink: 0,
    },
    headerLeft: {
        flex: 1,
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
    },
    modeChip: {
        flexShrink: 0,
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        background: "#fff1b8",
        color: "#874d00",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    title: {
        fontSize: 13,
        fontWeight: 600,
        color: "#051729",
        whiteSpace: "nowrap" as const,
        overflow: "hidden" as const,
        textOverflow: "ellipsis" as const,
        minWidth: 0,
    },
    closeButton: {
        flexShrink: 0,
        fontSize: 14,
        padding: "2px 8px",
        background: "white",
        color: "rgba(5, 23, 41, 0.65)",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 4,
        cursor: "pointer",
    },
    body: {
        flex: 1,
        overflow: "auto" as const,
        padding: 16,
        background: "#fafafa",
    },
    pre: {
        margin: 0,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.6,
        color: "#051729",
    },
    line: {
        whiteSpace: "pre" as const,
    },
    footer: {
        padding: "8px 14px",
        borderTop: "1px solid rgba(5, 23, 41, 0.08)",
        background: "white",
        flexShrink: 0,
    },
    footerNote: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.55)",
    },
}

export default RowDetailPopover
