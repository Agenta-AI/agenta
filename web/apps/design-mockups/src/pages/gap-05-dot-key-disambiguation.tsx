/**
 * Gap 05 — Dot-key vs nested disambiguation (concept page).
 *
 * Problem statement + proposed solution. Live demo on /solutions-drill-in
 * (pick the "08 collision" fixture).
 */

import Head from "next/head"
import Link from "next/link"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"

export default function Gap05Concept() {
    return (
        <>
            <Head>
                <title>Gap 05 — Dot-key vs nested path disambiguation</title>
            </Head>
            <MockupPageShell
                title="Gap 05 — Dot-key vs nested path disambiguation"
                blurb={
                    "A testcase can store a key in two ways and they mean different things at template-render time: literal `{ \"geo.region\": \"...\" }` versus nested `{ geo: { region: \"...\" } }`. Both are valid JSON, both are stored faithfully, but `{{geo.region}}` resolves to the literal first under the RFC's literal-key-first rule. The UI today doesn't mark the distinction."
                }
                notes={
                    <>
                        <strong>The two shapes are different things:</strong>
                        <ul style={styles.list}>
                            <li>
                                <code>{"{{geo.region}}"}</code> returns the
                                literal key first, falls back to nested
                                traversal.
                            </li>
                            <li>
                                <code>{"{{$.geo.region}}"}</code> JSONPath
                                always traverses (ignores literal keys).
                            </li>
                        </ul>
                        The user's authoring choice matters. The UI doesn't
                        currently mark it.
                        <br />
                        <br />
                        <strong>What we see in fixture 08 today:</strong> the
                        column-grouping model already shows the two shapes as
                        separate columns — literal <code>&quot;geo.region&quot;</code>{" "}
                        is a flat top-level column, and nested <code>geo</code>{" "}
                        expands via <code>&gt;</code> into <code>region</code> /
                        <code>subregion</code> sub-columns. Both visible
                        side-by-side. The structural separation works.{" "}
                        <strong>What's missing is labeling.</strong>
                        <br />
                        <br />
                        <strong>Proposed:</strong>
                        <ul style={styles.list}>
                            <li>
                                <code>[dotted-key]</code> chip on the literal
                                row, signalling "this is a flat top-level key,
                                not a path."
                            </li>
                            <li>
                                <code>[⚠ collision]</code> chip when literal
                                AND nested both exist on the same row.
                                Stacks with <code>[dotted-key]</code> on the
                                literal side.
                            </li>
                            <li>
                                <code>[shadowed]</code> chip on the nested side
                                when the literal silently overrides at runtime
                                (literal-key-first rule).
                            </li>
                        </ul>
                    </>
                }
                competitiveNotes={
                    <>
                        Braintrust's drill-in form lists literal{" "}
                        <code>&quot;a.b&quot;</code> as one input and nested{" "}
                        <code>a.b</code> as a separate indented input under{" "}
                        <code>a</code> — visually distinct rows, no chip needed
                        because the form shape does the disambiguation.
                        Langfuse renders both shapes in one JSON blob with no
                        marker. Our chip + form structure (gap-07) combined =
                        best-in-class. See{" "}
                        <a
                            href="../../../docs/designs/json-string-ux/competitive-analysis.md"
                            style={styles.link}
                        >
                            competitive-analysis.md
                        </a>{" "}
                        §5.
                    </>
                }
            >
                <Link href="/solutions-drill-in" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>
                        Solutions · Drill-in — full demo →
                    </span>
                    <span style={styles.ctaBlurb}>
                        Pick the "08 dot-key collision" fixture (Vanuatu) from
                        the toolbar. The literal <code>&quot;geo.region&quot;</code>{" "}
                        field shows <code>[dotted-key]</code> +{" "}
                        <code>[⚠ collision]</code>; the nested <code>geo</code>{" "}
                        sibling shows <code>[⚠ collision]</code>.
                    </span>
                </Link>

                <div style={styles.crossLinks}>
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-01-type-chips" style={styles.link}>
                        gap-01 (chip vocabulary, including [dotted-key] / [⚠
                        collision] / [shadowed])
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-04-shape-preservation" style={styles.link}>
                        gap-04 (shape preservation prevents shadowing on save)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-07-schema-aware-form" style={styles.link}>
                        gap-07 (schema-aware form does most of the
                        disambiguation work structurally)
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
