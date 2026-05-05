/**
 * Gap 08 — Playground variable validation (concept page).
 *
 * Problem statement + proposed solution. Live demo on /solutions-playground
 * (variable-validation prompt section). The PromptVariableValidation
 * component lives at src/components/proposed/PromptVariableValidation.tsx
 * and is shared across pages.
 */

import Head from "next/head"
import Link from "next/link"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"

export default function Gap08Concept() {
    return (
        <>
            <Head>
                <title>Gap 08 — Playground variable validation</title>
            </Head>
            <MockupPageShell
                title="Gap 08 — Playground variable validation"
                blurb={
                    "Surfaced 2026-05-04 by competitive analysis. Banner on dataset-attach naming canonical references; per-variable tooltip when a referenced path doesn't resolve in the attached testset's schema. Edit-time check, not runtime. Inherits the schema entity from gap-07."
                }
                notes={
                    <>
                        <strong>What's broken today:</strong> Agenta's playground
                        resolves <code>{"{{variable}}"}</code> references at run
                        time only. If the user references{" "}
                        <code>{"{{metadata.source}}"}</code> and the attached
                        testset doesn't have that path, they discover it via a
                        confusing run output (empty string substitution or a
                        stringified-JSON literal depending on resolution).
                        <br />
                        <br />
                        <strong>Proposed (Braintrust pattern):</strong> two
                        surfaces:
                        <ul style={styles.list}>
                            <li>
                                <strong>Dataset-attach banner.</strong> The
                                moment a testset is wired in, surface a blue
                                inline banner naming the canonical references{" "}
                                <code>{"{{(input)}}"}</code>,{" "}
                                <code>{"{{(expected)}}"}</code>,{" "}
                                <code>{"{{(metadata)}}"}</code>. Templating
                                newcomers get a working starting point without
                                hunting.
                            </li>
                            <li>
                                <strong>Per-variable tooltip.</strong> Each
                                variable reference is validated against the
                                attached testset's schema. Mismatches render an
                                inline red-bordered tooltip with the specific
                                variable name + a Remove-variable
                                quick-action. Edit-time, not runtime.
                            </li>
                        </ul>
                        <br />
                        <strong>Why this is gap-07's downstream:</strong> the
                        validation reads from the same per-testset schema entity
                        gap-07 establishes. Without gap-07's schema, the
                        tooltip can only do generic template-syntax checks; with
                        it, the tooltip says <em>"this path isn't in your
                        dataset"</em> — exactly the specificity that makes
                        Braintrust's pattern work.
                        <br />
                        <br />
                        <strong>Stringified-JSON fault line (gap-04 echo):</strong>{" "}
                        Braintrust's variable validator false-warns on{" "}
                        <code>{"{{metadata.source}}"}</code> when the column is
                        a stringified JSON string (their schema treats it as a
                        string, not a parsed object). Same fault line as
                        gap-04. Our gap-02 parse-on-detect feeds gap-08's
                        correctness — without parsing, even Braintrust gets it
                        wrong.
                    </>
                }
                competitiveNotes={
                    <>
                        Closest pattern in the field. Braintrust validates both{" "}
                        <code>{"{{a.b}}"}</code> flat-mustache and{" "}
                        <code>{"{{$.a.b}}"}</code> JSONPath against the
                        dataset's actual schema — same mechanism, two syntaxes.
                        Langfuse has no edit-time validation. See{" "}
                        <a
                            href="../../../docs/designs/json-string-ux/competitive-analysis.md"
                            style={styles.link}
                        >
                            competitive-analysis.md
                        </a>{" "}
                        §13.
                    </>
                }
            >
                <Link href="/solutions-playground" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>
                        Solutions · Playground — variable-validation prompt
                        section →
                    </span>
                    <span style={styles.ctaBlurb}>
                        See the dataset-attach banner + per-variable tooltip in
                        action. Today (no validation, runtime-only) next to
                        Proposed (banner + tooltip). The execution-item
                        comparison grid below covers the input/output side of
                        the playground surface.
                    </span>
                </Link>

                <div style={styles.crossLinks}>
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-02-table-cells" style={styles.link}>
                        gap-02 (parse-on-detect feeds correctness)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-04-shape-preservation" style={styles.link}>
                        gap-04 (stringified-JSON fault line)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-05-dot-key-disambiguation" style={styles.link}>
                        gap-05 (the {"{{a.b}}"} disambiguation also applies to
                        playground references)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-07-schema-aware-form" style={styles.link}>
                        gap-07 (schema entity — same source of truth)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-09-variable-provenance" style={styles.link}>
                        gap-09 (symmetric check on the execution-item surface)
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
