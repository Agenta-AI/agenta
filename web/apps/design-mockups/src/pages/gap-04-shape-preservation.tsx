/**
 * Gap 04 — Union projection / shape preservation (concept page).
 *
 * Problem statement + proposed solution. Live demos on /solutions-drill-in
 * (with [not authored] chip) and /solutions-tables (em-dash for missing keys).
 */

import Head from "next/head"
import Link from "next/link"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"

export default function Gap04Concept() {
    return (
        <>
            <Head>
                <title>Gap 04 — Union projection / shape preservation</title>
            </Head>
            <MockupPageShell
                title="Gap 04 — Union projection / shape preservation"
                blurb={
                    "When the testset has heterogeneous rows (some rows author column X, others don't), the drill-in's JSON view materializes empty fallbacks for keys not actually authored on this row. Saving the JSON view replays those empties into the draft, polluting storage. Under literal-key-first templating, the empty `\"geo.region\"` can silently shadow nested traversal at runtime."
                }
                notes={
                    <>
                        <strong>Backend is fine (verified):</strong> per{" "}
                        <code>backend-response data/02-response.json</code> and{" "}
                        <code>08-response.json</code>, the BE returns each
                        testcase's <code>data</code> exactly as uploaded. No
                        injected keys.
                        <br />
                        <br />
                        <strong>What the FE does:</strong> the column union
                        is intentional.{" "}
                        <code>currentColumnsAtom</code> in{" "}
                        <code>molecule.ts:210-244</code> walks every testcase's{" "}
                        <code>data</code> and unions the keys into one column
                        set so every cell has a position in the table grid.
                        Where the empties appear at render time:{" "}
                        <code>EntityDualViewEditor.tsx:144-155</code> walks
                        every column and writes{" "}
                        <code>values[col.key] = entityData[col.key] ?? ""</code>.
                        For Kiribati on fixture 08, that materializes the
                        literal-dotted keys{" "}
                        <code>&quot;geo.region&quot;</code> /{" "}
                        <code>&quot;geo.subregion&quot;</code> as empty strings
                        even though the row only authored nested <code>geo</code>.
                        <br />
                        <br />
                        <strong>Proposed (two layers):</strong>
                        <ul style={styles.list}>
                            <li>
                                <strong>Render-only marker.</strong> The
                                drill-in shows union-projected keys with the{" "}
                                <code>[not authored]</code> chip so the user
                                knows the field isn't part of this row's stored
                                shape.
                            </li>
                            <li>
                                <strong>Save-side filter.</strong> Before
                                dispatching a JSON-edit save, diff against the
                                row's actual <code>data</code> and drop empty
                                strings for keys the row doesn't author. State
                                stays clean.
                            </li>
                        </ul>
                        <br />
                        Either layer addresses the runtime risk on its own.
                        Together: the marker tells the user what's happening,
                        the save-side filter keeps storage clean.
                    </>
                }
            >
                <Link href="/solutions-drill-in" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>
                        Solutions · Drill-in — see [not authored] chip on
                        union-projected keys →
                    </span>
                    <span style={styles.ctaBlurb}>
                        Pick the "08 dot-key collision" fixture and look at the
                        Kiribati row — keys authored by other rows show with the
                        muted <code>[not authored]</code> chip. Save-side filter
                        is conceptual (no save loop in the mockup).
                    </span>
                </Link>
                <Link href="/solutions-tables" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>
                        Solutions · Tables — see em-dash for missing keys →
                    </span>
                    <span style={styles.ctaBlurb}>
                        The "missing key" row in the fixture grid demonstrates
                        the table-side rendering: <code>—</code> when the column
                        exists in other rows but not this one. Distinct from
                        null (which has its own chip).
                    </span>
                </Link>

                <div style={styles.crossLinks}>
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-01-type-chips" style={styles.link}>
                        gap-01 ([not authored] chip in vocabulary)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-03-drill-in-root-view" style={styles.link}>
                        gap-03 (auto-expand surfaces the union)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-05-dot-key-disambiguation" style={styles.link}>
                        gap-05 (dot-key collision compounds the issue)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-09-variable-provenance" style={styles.link}>
                        gap-09 (same shape applied at the execution-item surface)
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
