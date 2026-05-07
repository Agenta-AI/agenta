/**
 * Gap 03 — Drill-in root view auto-expand (concept page).
 *
 * Audited against production 2026-05-04. The collapse/expand machinery
 * exists today (`collapsedFields` state, `showFieldCollapse` prop) but
 * nothing auto-expands at first render — root keys with structured values
 * show as `[json-object] [Drill In]` button rows. Auto-expand is the new
 * behavior gap-03 proposes; everything else is already wired.
 */

import Head from "next/head"
import Link from "next/link"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"

export default function Gap03Concept() {
    return (
        <>
            <Head>
                <title>Gap 03 — Drill-in root view auto-expand</title>
            </Head>
            <MockupPageShell
                title="Gap 03 — Drill-in root view auto-expand"
                blurb={
                    "Production already has per-field collapse, drill-in navigation, view-mode dropdown, and ChatMessageList rendering for messages-shaped values. What it doesn't have: auto-expand at first render. Open a deeply-nested testcase and the root inputs/outputs render as one big code editor each (when in view-mode mode) or as a `[json-object] [Drill In]` row that requires a click. The proposal: auto-expand the first level of every object/array inline as nested cards."
                }
                notes={
                    <>
                        <strong>What production already has:</strong> <code>DrillInContent</code>{" "}
                        ships with <code>collapsedFields</code> state, a per-field caret button (
                        <code>DrillInFieldHeader</code>), and the <code>showFieldCollapse</code>{" "}
                        prop. Each field can be collapsed and re-expanded individually after first
                        render. Messages rendering at any level uses <code>ChatMessageList</code>{" "}
                        automatically (line 1284 of <code>DrillInContent.tsx</code>). All of this
                        works today.
                        <br />
                        <br />
                        <strong>What's missing:</strong> auto-expand on first render. The default
                        state is "collapsed cards at the root" — for testcases with nested{" "}
                        <code>inputs</code> or <code>outputs</code>, the user sees{" "}
                        <code>
                            inputs <span style={styles.code}>[json-object]</span>{" "}
                            <span style={styles.code}>[Drill In]</span>
                        </code>{" "}
                        instead of the second-level fields. They have to click to discover what's
                        inside.
                        <br />
                        <br />
                        <strong>What gap-03 actually proposes:</strong> a new{" "}
                        <code>autoExpand</code> prop on the drill-in component. When true, the first
                        level of every object/array renders inline as nested cards. Deeper levels
                        still drill in (rendering a 5-level tree at once would be worse, not
                        better). The existing collapse machinery still works — the user can collapse
                        a card they don't care about. Gap-07's schema-aware form is the bigger
                        version of the same idea: when a per-testset schema exists, render as a
                        labelled form instead of detection-driven cards.
                        <br />
                        <br />
                        <strong>Why it matters for other gaps:</strong>
                        <ul style={styles.list}>
                            <li>
                                <strong>gap-06</strong>: messages render at root without an extra
                                click. Production already renders <code>ChatMessageList</code> for
                                messages-shaped fields — just at the level the user is currently
                                focused. Auto-expand brings that to root.
                            </li>
                            <li>
                                <strong>gap-04</strong>: the union of authored vs not-authored keys
                                becomes visible at first render instead of being hidden behind a
                                click.
                            </li>
                        </ul>
                    </>
                }
            >
                <Link href="/solutions-drill-in" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>Solutions · Drill-in — full demo →</span>
                    <span style={styles.ctaBlurb}>
                        The kitchen-sink Vanuatu row has nested <code>inputs</code>,{" "}
                        <code>outputs</code>, and <code>geo</code> (with{" "}
                        <code>geo.coordinates</code> going three levels deep) plus a messages array
                        — so auto-expand fires across all of it. Production drawer (collapsed at
                        root) on the left vs <code>ProposedDrillIn</code> with{" "}
                        <code>autoExpand=true</code> on the right.
                    </span>
                </Link>

                <div style={styles.crossLinks}>
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-01-type-chips" style={styles.link}>
                        gap-01 (chips on the auto-expanded cards)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-04-shape-preservation" style={styles.link}>
                        gap-04 (auto-expand surfaces the union shape)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-06-messages-renderer" style={styles.link}>
                        gap-06 (messages render at root once auto-expand lands)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-07-schema-aware-form" style={styles.link}>
                        gap-07 (schema-aware form — the bigger version, replaces detection-driven
                        cards)
                    </Link>
                </div>
            </MockupPageShell>
        </>
    )
}

const styles = {
    list: {margin: "8px 0", paddingLeft: 20, lineHeight: 1.7},
    code: {
        fontSize: 11,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        background: "rgba(5, 23, 41, 0.06)",
        padding: "0 4px",
        borderRadius: 3,
    },
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
