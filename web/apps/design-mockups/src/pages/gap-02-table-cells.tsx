/**
 * Gap 02 — Testset table cell preview format (concept page).
 *
 * Rescoped 2026-05-04: production already has CellContentPopover,
 * JsonCellContent, ChatMessagesCellContent, TextCellContent (in
 * @agenta/ui/cell-renderers). The chip-vocabulary side of this surface is
 * gap-01 applied to tables — see /solutions-tables. What's unique here is
 * the *preview format choice*: dense chip+count+sample vs production's
 * truncated JSON dump.
 */

import Head from "next/head"
import Link from "next/link"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"

export default function Gap02Concept() {
    return (
        <>
            <Head>
                <title>Gap 02 — Testset table cell preview format</title>
            </Head>
            <MockupPageShell
                title="Gap 02 — Testset table cell preview format"
                blurb={
                    "Production already has cell popovers, syntax-highlighted JSON, chat-message detection, em-dash for missing values. What's missing is a denser preview format: chip + count + sample keys/values, instead of a multi-line JSON dump that fills the cell. This gap is mostly gap-01 applied to tables — the chip vocabulary side lives there. What's unique to gap-02 is the preview format itself, plus the popover content choice for stringified-JSON."
                }
                notes={
                    <>
                        <strong>What production already does:</strong>{" "}
                        <code>
                            web/oss/src/components/TestcasesTableNew/components/TestcaseCellContent.tsx
                        </code>{" "}
                        delegates to <code>@agenta/ui/cell-renderers</code> —
                        <ul style={styles.list}>
                            <li>
                                <code>tryParseJson</code> + <code>extractChatMessages</code> for
                                type detection
                            </li>
                            <li>
                                <code>JsonCellContent</code> (syntax-highlighted JSON),{" "}
                                <code>ChatMessagesCellContent</code>, <code>TextCellContent</code>{" "}
                                for renderers
                            </li>
                            <li>
                                <code>CellContentPopover</code> — hover popover with full content +
                                Copy button
                            </li>
                            <li>
                                Em-dash placeholder for <code>null</code> / <code>undefined</code> /
                                empty string
                            </li>
                            <li>
                                <code>maxLines={"{10}"}</code> truncation in the cell preview
                            </li>
                        </ul>
                        Functional today. Visible problem: a deeply-nested object renders as ~10
                        lines of multi-line JSON inside the cell — burns vertical space and reads
                        slow.
                        <br />
                        <br />
                        <strong>What gap-02 actually proposes:</strong> a denser{" "}
                        <em>preview format</em>:
                        <ul style={styles.list}>
                            <li>
                                Line 1: <code>[obj]</code> chip + <code>{"{ 4 props }"}</code> count
                            </li>
                            <li>Line 2: comma-separated first 2-3 keys (or values for arrays)</li>
                            <li>
                                Cell stays ~2 lines tall regardless of nested depth. Hover popover
                                (existing) <code>CellContentPopover</code> still shows the full
                                structure.
                            </li>
                            <li>
                                Stringified-JSON: distinct <code>[stringified]</code> chip,
                                parse-on-detect affordance, popover shows the <em>parsed</em>{" "}
                                structure (production shows the raw escaped string).
                            </li>
                            <li>
                                Mixed columns get the <code>[mixed]</code> chip; dotted-key columns
                                get <code>[dotted-key]</code>; collision rows stack{" "}
                                <code>[⚠ collision]</code>.
                            </li>
                        </ul>
                        <br />
                        <strong>Relationship to gap-01:</strong> chips on cells = gap-01 applied to
                        a different surface. The format proposal here (count, sample keys,
                        popover-on-parsed) is the cell-specific contribution. Both ship together on{" "}
                        <Link href="/solutions-tables" style={styles.link}>
                            /solutions-tables
                        </Link>{" "}
                        — same component, same chip-mode toggle.
                        <br />
                        <br />
                        <strong>Production reuse path:</strong> the dense preview can ship as a new
                        option inside <code>JsonCellContent</code> (e.g.{" "}
                        <code>variant=&quot;summary&quot;</code>) so the rest of the renderer
                        pipeline doesn't change. Or as a new sibling renderer (
                        <code>SummaryCellContent</code>) called by <code>TestcaseCellContent</code>{" "}
                        when the user toggles density.
                    </>
                }
            >
                <Link href="/solutions-tables" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>Solutions · Tables — full demo →</span>
                    <span style={styles.ctaBlurb}>
                        Side-by-side fixture grid: production <code>TestcaseCellContent</code> (with
                        popover, syntax highlighting, chat preview) on the left vs{" "}
                        <code>ProposedTableCell</code> (chip + count + sample keys preview) on the
                        right. Each row tagged with the relevant gap.
                    </span>
                </Link>

                <div style={styles.crossLinks}>
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-01-type-chips" style={styles.link}>
                        gap-01 (chip vocabulary — most of what's "missing" on cells today is the
                        chip side)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-04-shape-preservation" style={styles.link}>
                        gap-04 (em-dash for missing keys — already in production, gap-04 just adds
                        the conceptual marker)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-05-dot-key-disambiguation" style={styles.link}>
                        gap-05 (dotted-key on column headers — composes with cell rendering)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-06-messages-renderer" style={styles.link}>
                        gap-06 (messages preview — production already has{" "}
                        <code>ChatMessagesCellContent</code>)
                    </Link>
                </div>
            </MockupPageShell>
        </>
    )
}

const styles = {
    list: {margin: "8px 0", paddingLeft: 20, lineHeight: 1.7},
    link: {color: "#1677ff", fontWeight: 500},
    cta: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 6,
        padding: "16px 20px",
        background: "#e6fffb",
        border: "1px solid #13c2c2",
        borderRadius: 8,
        textDecoration: "none",
        color: "#051729",
        marginBottom: 16,
    },
    ctaTag: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        background: "#13c2c2",
        color: "white",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        alignSelf: "flex-start" as const,
    },
    ctaTitle: {fontSize: 14, fontWeight: 700, color: "#006d75"},
    ctaBlurb: {fontSize: 12, color: "#051729", lineHeight: 1.6},
    crossLinks: {
        padding: "10px 14px",
        background: "#fafafa",
        border: "1px solid rgba(5, 23, 41, 0.06)",
        borderRadius: 8,
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.8,
    },
}
