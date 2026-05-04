/**
 * Gap 06 — Messages renderer coverage (concept page).
 *
 * Problem statement + proposed solution. Live demos on /solutions-drill-in
 * (pick "07 messages + tools" fixture) and /solutions-playground (Row 2 —
 * messages trace).
 */

import Head from "next/head"
import Link from "next/link"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"

export default function Gap06Concept() {
    return (
        <>
            <Head>
                <title>Gap 06 — Messages renderer coverage</title>
            </Head>
            <MockupPageShell
                title="Gap 06 — Messages renderer coverage"
                blurb={
                    "ChatMessageEditor exists in the codebase and renders messages-shaped arrays beautifully (system/user/assistant cards, content, tool_calls). But it only kicks in inside the drill-in after a user navigates into the messages array. At the root, large arrays of message-shaped objects fall through to the generic JSON editor. tool_calls are never given the dedicated treatment even though they're structurally similar."
                }
                notes={
                    <>
                        <strong>What's broken today:</strong>
                        <ul style={styles.list}>
                            <li>
                                Drill-in Fields view (root) — when{" "}
                                <code>messages</code> is a top-level value:
                                renders as a JSON code editor instead of
                                ChatMessageEditor.
                            </li>
                            <li>
                                Drill-in Fields view (after drill) —{" "}
                                <code>tool_calls</code>: stays as raw JSON code
                                editor instead of a dedicated tool-call view.
                            </li>
                            <li>
                                Testset table — <code>tool_calls</code> column:
                                raw JSON or single-line summary.
                            </li>
                        </ul>
                        <strong>The pattern:</strong> ChatMessageEditor is wired
                        only after Drill In. <code>tool_calls</code> never get
                        rich treatment.
                        <br />
                        <br />
                        <strong>Proposed:</strong>
                        <ul style={styles.list}>
                            <li>
                                Lift the messages auto-detection out of{" "}
                                <code>DrillInContent</code> (
                                <code>line 1284</code>) into a shared helper so
                                root-level message arrays render with the
                                ChatMessageEditor.
                            </li>
                            <li>
                                Detect tool-call shapes (
                                <code>{"{role: \"assistant\", tool_calls: [...]}"}</code>
                                ) and render an inline tool-call card with the
                                parsed <code>arguments</code> JSON pretty-printed.
                            </li>
                            <li>
                                Surface tool-call counts in table cells with
                                the <code>[tool]</code> chip.
                            </li>
                        </ul>
                    </>
                }
                competitiveNotes={
                    <>
                        Both Braintrust and Langfuse render messages as YAML or
                        JSON respectively — no chat cards, no tool-call cards.
                        Lifting <code>ChatMessageEditor</code> + the tool-call
                        card puts us past both competitors. One of three places
                        we go further than the field rather than catch up. See{" "}
                        <a
                            href="../../../docs/designs/json-string-ux/competitive-analysis.md"
                            style={styles.link}
                        >
                            competitive-analysis.md
                        </a>{" "}
                        §6.
                    </>
                }
            >
                <Link href="/solutions-drill-in" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>
                        Solutions · Drill-in — full demo →
                    </span>
                    <span style={styles.ctaBlurb}>
                        Pick the "07 messages + tools" fixture from the toolbar.
                        ChatMessageEditor renders inline at root with role
                        cards; the assistant message's <code>tool_calls</code>{" "}
                        block shows a parsed-arguments card.
                    </span>
                </Link>
                <Link href="/solutions-playground" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>
                        Solutions · Playground — Row 2 (messages trace) →
                    </span>
                    <span style={styles.ctaBlurb}>
                        The messages trace fixture in the playground three-way
                        compare grid. Today renders messages as a textarea
                        placeholder; Proposed renders chat cards inline; Alt
                        compact summarizes (
                        <code>3 messages · system + user + assistant</code>) and
                        expands on click.
                    </span>
                </Link>

                <div style={styles.crossLinks}>
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-01-type-chips" style={styles.link}>
                        gap-01 ([msgs] + [tool] chips)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-02-table-cells" style={styles.link}>
                        gap-02 (messages preview in table cells)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-03-drill-in-root-view" style={styles.link}>
                        gap-03 (auto-expand surfaces messages at root)
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
        marginBottom: 12,
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
        marginTop: 16,
        padding: "10px 14px",
        background: "#fafafa",
        border: "1px solid rgba(5, 23, 41, 0.06)",
        borderRadius: 8,
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.8,
    },
}
