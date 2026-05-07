/**
 * Gap 06 — Messages renderer coverage (concept page).
 *
 * Audited 2026-05-04 against production code. Most of "messages renderer"
 * already ships:
 *   - DrillInContent.tsx:1284-1298 — ChatMessageList renders ANY field where
 *     `dataType === "messages"`, regardless of editability.
 *   - ToolMessageHeader for `role: "tool"`.
 *   - extractDisplayTextFromMessage formats assistant tool_calls as text
 *     strings like `get_weather({"city":"NYC"})`.
 *
 * What's NOT in production:
 *   - Auto-rendering at root (subset of gap-03 — fixed when auto-expand lands).
 *   - Tool-call CARD UI (production renders tool calls as inline text).
 *   - [tool-calls] chip in table cells (subset of gap-01 chip vocabulary).
 *
 * So gap-06's unique contribution is just the tool-call card. The rest is
 * gap-03 + gap-01 applied to a specific case.
 */

import Head from "next/head"
import Link from "next/link"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"

export default function Gap06Concept() {
    return (
        <>
            <Head>
                <title>Gap 06 — Messages + tool-call card</title>
            </Head>
            <MockupPageShell
                title="Gap 06 — Messages + tool-call card"
                blurb={
                    "ChatMessageList already renders messages-shaped arrays in production. ToolMessageHeader handles role: \"tool\" responses. What's missing: a dedicated card for assistant tool_calls (today they render as inline text via extractDisplayTextFromMessage), and the [tool-calls] chip in table cells (gap-01 vocabulary applied here). Auto-rendering at root is gap-03's job — once auto-expand lands, messages render at root for free."
                }
                notes={
                    <>
                        <strong>What production already does:</strong>
                        <ul style={styles.list}>
                            <li>
                                <code>DrillInContent.tsx</code> line 1284-1298: ANY field where{" "}
                                <code>dataType === &quot;messages&quot;</code> renders via{" "}
                                <code>ChatMessageList</code> unconditionally — comment says
                                "regardless of editability". So messages DO render with chat cards,
                                just only at the depth the user has drilled to.
                            </li>
                            <li>
                                <code>ChatMessageList</code> (
                                <code>web/packages/agenta-ui/src/ChatMessage/</code>) renders role
                                badges + content + handles <code>role: &quot;tool&quot;</code>{" "}
                                responses via <code>ToolMessageHeader</code>.
                            </li>
                            <li>
                                Assistant messages with <code>tool_calls</code> use{" "}
                                <code>extractDisplayTextFromMessage</code> which formats them as
                                inline text like <code>get_weather({'{"city": "NYC"}'})</code>.
                                Readable, but it sits in the message body with no visual separation
                                from prose content.
                            </li>
                            <li>
                                Table cells: <code>ChatMessagesCellContent</code> shows a chat
                                preview already. Same renderer pipeline.
                            </li>
                        </ul>
                        <br />
                        <strong>
                            What gap-06 actually proposes (after accounting for what already ships):
                        </strong>
                        <ul style={styles.list}>
                            <li>
                                <strong>Dedicated tool-call card.</strong> Render assistant{" "}
                                <code>tool_calls</code> as a card below the message body: function
                                name as a heading, arguments JSON pretty-printed (parsed from the
                                string). This is the new rendering. The OpenAI chat-message contract
                                stores <code>arguments</code> as a JSON string, which is why
                                production currently shows it inline as text rather than as
                                structured fields.
                            </li>
                            <li>
                                <strong>
                                    <code>[tool-calls]</code> chip in table cells
                                </strong>{" "}
                                — part of gap-01 chip vocabulary applied to tool-call columns. Lets
                                the user see tool-call columns at a glance.
                            </li>
                            <li>
                                <strong>Root-level rendering</strong> — falls out of gap-03
                                (auto-expand). When auto-expand lands, the user sees{" "}
                                <code>inputs.messages</code> rendered with chat cards at root
                                without the drill-in click.
                                <em>
                                    {" "}
                                    Not a unique gap-06 contribution; the lift comes from gap-03.
                                </em>
                            </li>
                        </ul>
                        <br />
                        <strong>Subset relationship:</strong> the unique gap-06 piece is the
                        tool-call card. Everything else is either already in production (
                        <code>ChatMessageList</code> + chat preview) or comes from another gap
                        (gap-03 auto-expand, gap-01 chip). Calling it out as its own gap because the
                        tool-call card has its own design surface that doesn't fit cleanly under
                        gap-01 or gap-03.
                    </>
                }
            >
                <Link href="/solutions-drill-in" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>Solutions · Drill-in — full demo →</span>
                    <span style={styles.ctaBlurb}>
                        The kitchen-sink Vanuatu row's <code>messages</code> array includes a 5-turn
                        conversation with a tool call (<code>lookup_country</code>) and a{" "}
                        <code>role: &quot;tool&quot;</code> response. <code>ChatMessageList</code>{" "}
                        renders inline at root via gap-03 auto-expand; the assistant message's{" "}
                        <code>tool_calls</code> shows as a parsed-arguments card (gap-06's unique
                        contribution).
                    </span>
                </Link>
                <Link href="/solutions-playground" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>Solutions · Playground — kitchen-sink row →</span>
                    <span style={styles.ctaBlurb}>
                        Same Vanuatu messages array on the three-way compare grid. Today renders
                        messages as a borderless textarea placeholder; Proposed (embedded) renders
                        chat cards inline; Alt (compact) summarizes (
                        <code>5 messages · system + user + assistant…</code>) and expands on click.
                    </span>
                </Link>

                <div style={styles.crossLinks}>
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-01-type-chips" style={styles.link}>
                        gap-01 ([messages] + [tool-calls] chips, both in vocabulary)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-02-table-cells" style={styles.link}>
                        gap-02 (messages preview in table cells — already in production via{" "}
                        <code>ChatMessagesCellContent</code>)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-03-drill-in-root-view" style={styles.link}>
                        gap-03 (auto-expand surfaces messages at root — root rendering is gap-03's
                        job, not gap-06's)
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
