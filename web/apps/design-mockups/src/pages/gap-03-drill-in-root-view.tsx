/**
 * Gap 03 — Drill-in root view bails to a code editor (concept page).
 *
 * Problem statement + proposed solution. Live demo on /solutions-drill-in
 * (pick the "06 deeply nested" fixture).
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
                    "Open a deeply-nested testcase in the production drawer and the root inputs/outputs render as one big code editor each instead of per-property cards. The user has to click `Drill In` to get the structured editor. The proposal: auto-expand top-level keys inline as nested cards, so the user sees the testcase's shape immediately."
                }
                notes={
                    <>
                        <strong>What's broken today:</strong> open Testcase 1 of
                        fixture 04 (stringified nested) or fixture 06 (deeply
                        nested) in the drawer. The root <code>inputs</code> and{" "}
                        <code>outputs</code> render as code editors, not cards.
                        Drilling in works fine — but the user has to click first.
                        Until then, it's a wall of JSON.
                        <br />
                        <br />
                        <strong>Proposed:</strong> auto-expand the first level of
                        every object/array inline as nested cards (
                        <code>autoExpand=true</code> on{" "}
                        <code>ProposedDrillIn</code>). Deeper levels still drill
                        in (we don't want to render a 5-level tree at once). The
                        user sees the shape — names, counts, chips — without an
                        extra click. Schema-aware form (gap-07) is the higher
                        ceiling: when a per-testset schema exists, render as a
                        labelled form instead of detection-driven cards.
                    </>
                }
                competitiveNotes={
                    <>
                        Braintrust validates this direction — their drill-in
                        opens to a labelled form. Langfuse opens a modal with
                        three side-by-side JSON code editors (the bailout we're
                        explicitly avoiding). See{" "}
                        <a
                            href="../../../docs/designs/json-string-ux/competitive-analysis.md"
                            style={styles.link}
                        >
                            competitive-analysis.md
                        </a>{" "}
                        §3.
                    </>
                }
            >
                <Link href="/solutions-drill-in" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>
                        Solutions · Drill-in — full demo →
                    </span>
                    <span style={styles.ctaBlurb}>
                        Pick the "06 deeply nested" fixture from the toolbar to
                        see auto-expand in action. Production drawer (collapsed
                        at root) on the left vs ProposedDrillIn (auto-expanded
                        cards) on the right.
                    </span>
                </Link>

                <div style={styles.crossLinks}>
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-01-type-chips" style={styles.link}>
                        gap-01 (chips on auto-expanded cards)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-04-shape-preservation" style={styles.link}>
                        gap-04 (union-projection markers)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-06-messages-renderer" style={styles.link}>
                        gap-06 (chat cards in the auto-expanded body)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-07-schema-aware-form" style={styles.link}>
                        gap-07 (schema-aware form — higher ceiling)
                    </Link>
                </div>
            </MockupPageShell>
        </>
    )
}

const styles = {
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
