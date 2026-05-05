/**
 * Gap 07 — Schema-aware Edit form (concept page).
 *
 * Problem statement + proposed solution. Live demo on /solutions-drill-in
 * (toggle "Schema-aware form" mode). The SchemaForm component itself lives
 * at src/components/proposed/SchemaForm.tsx and is shared across pages.
 */

import Head from "next/head"
import Link from "next/link"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"

export default function Gap07Concept() {
    return (
        <>
            <Head>
                <title>Gap 07 — Schema-aware Edit form</title>
            </Head>
            <MockupPageShell
                title="Gap 07 — Schema-aware Edit form"
                blurb={
                    "Surfaced 2026-05-04 by competitive analysis. Per-testset field schema becomes a first-class entity; drill-in renders as a labelled form with type-aware inputs per known column when a schema exists; falls back to the existing detection-driven view otherwise. The same schema entity also feeds gap-08 validation and reshapes how gap-03 / gap-04 / gap-05 land."
                }
                notes={
                    <>
                        <strong>What's broken today:</strong> the production
                        drill-in detects the type of each value in <em>this row</em>.
                        Widgets are picked per row. If a row has only 3 of the
                        testset's 5 known columns, the user sees only 3 fields —
                        no signal that 2 more exist. Type changes across rows
                        are silently absorbed.
                        <br />
                        <br />
                        <strong>Proposed:</strong> a per-testset schema (inferred
                        on first import or authored explicitly) drives the form.
                        Every known column shows up regardless of whether{" "}
                        <em>this row</em> has it. Required fields are flagged.
                        Type-aware inputs per column. Per-field PATCH on save (no
                        JSON-blob replay).
                        <br />
                        <br />
                        <strong>Why this is cross-cutting:</strong> one
                        schema entity feeds gap-08 (playground variable
                        validation), sidesteps gap-04 (per-field PATCH save
                        means no union-JSON-blob replay), and gives gap-05 a
                        structural answer (literal{" "}
                        <code>&quot;a.b&quot;</code> and nested{" "}
                        <code>a.b</code> become two distinct labelled fields,
                        no chip needed). Gap-03 auto-expand is a simpler form
                        of the same idea.
                        <br />
                        <br />
                        <strong>Decision for the team call:</strong>{" "}
                        adopt schema-as-entity (Braintrust's pattern) or stay
                        schema-less (Langfuse pattern, current Agenta). One
                        schema entity has the most downstream reuse of any
                        decision on the table.
                    </>
                }
            >
                <Link href="/solutions-drill-in" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>
                        Solutions · Drill-in — schema-aware form rendering →
                    </span>
                    <span style={styles.ctaBlurb}>
                        The schema-aware form section sits below the
                        side-by-side drill-in comparison and renders the same
                        kitchen-sink Vanuatu row through a labelled form
                        driven by an inferred per-testset schema. Required
                        fields flagged, type-aware inputs per column, no
                        JSON-blob replay on save.
                    </span>
                </Link>

                <div style={styles.crossLinks}>
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-03-drill-in-root-view" style={styles.link}>
                        gap-03 (auto-expand — schema-aware form is the bigger
                        version of the same idea)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-04-shape-preservation" style={styles.link}>
                        gap-04 (per-field PATCH save sidesteps the union-projection
                        replay issue)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-05-dot-key-disambiguation" style={styles.link}>
                        gap-05 (form structure handles literal-vs-nested
                        disambiguation directly)
                    </Link>{" "}
                    ·{" "}
                    <Link
                        href="/gap-08-playground-variable-validation"
                        style={styles.link}
                    >
                        gap-08 (variable validation — same schema entity drives
                        it)
                    </Link>{" "}
                    ·{" "}
                    <Link
                        href="/gap-09-variable-provenance"
                        style={styles.link}
                    >
                        gap-09 (schema disambiguates draft vs authored on the
                        execution item)
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
