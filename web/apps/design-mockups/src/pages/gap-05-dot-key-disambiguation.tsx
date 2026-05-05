/**
 * Gap 05 — Dot-key vs nested disambiguation (concept page).
 *
 * Audited 2026-05-04. The chip variants `[dotted-key]`, `[⚠ collision]`,
 * `[shadowed]` are part of the gap-01 chip vocabulary. Production already
 * has the column-grouping logic that shows literal vs nested as separate
 * columns. What's unique to gap-05 is the *collision detection logic* —
 * recognizing when both shapes exist on the same row — and the chip
 * application driven by it.
 *
 * Sub-relationship: gap-05 is mostly gap-01 chip vocabulary applied to a
 * specific case via a small detection function. Calling it out separately
 * because the runtime correctness story (literal-key-first templating)
 * deserves its own conversation, not because the UI primitive is new.
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
                    "A testcase can store the same conceptual key two ways: literal `{ \"geo.region\": ... }` (a flat top-level key) versus nested `{ geo: { region: ... } }` (an object with a property). Both are valid JSON, both are stored faithfully, but `{{geo.region}}` resolves to the literal first under the RFC's literal-key-first rule. The UI doesn't currently mark which one templates resolve. The fix is a chip from gap-01 vocabulary plus a small collision-detection function."
                }
                notes={
                    <>
                        <strong>What production already does:</strong> the
                        column-grouping logic in{" "}
                        <code>currentColumnsAtom</code> /{" "}
                        <code>groupColumns</code> shows literal{" "}
                        <code>&quot;geo.region&quot;</code> as one flat column
                        and nested <code>geo</code> as another column that
                        expands via <code>&gt;</code> into{" "}
                        <code>region</code> / <code>subregion</code>{" "}
                        sub-columns. Structural separation works today — the
                        user can see both shapes in the table.{" "}
                        <strong>What's missing is labeling.</strong>
                        <br />
                        <br />
                        <strong>Relationship to gap-01:</strong> the chips
                        this gap uses (<code>[dotted-key]</code>,{" "}
                        <code>[⚠ collision]</code>, <code>[shadowed]</code>)
                        live in the gap-01 vocabulary. What gap-05 owns
                        independently: the collision-detection function, and
                        the runtime rule that literal-key wins over nested at
                        template time.
                        <br />
                        <br />
                        <strong>What gap-05 actually proposes:</strong>
                        <ul style={styles.list}>
                            <li>
                                <strong>Detection logic.</strong> When loading
                                a row, walk the keys: any key containing a dot
                                gets <code>[dotted-key]</code>; if its first
                                segment is also a key with an object value,
                                stack <code>[⚠ collision]</code> on both
                                sides; if literal-first templating would
                                shadow the nested traversal, also stack{" "}
                                <code>[shadowed]</code> on the nested side.
                            </li>
                            <li>
                                <strong>Chip application.</strong> Surface
                                those chips on the drill-in field row + the
                                column header in the table. Already part of
                                gap-01 vocabulary.
                            </li>
                            <li>
                                <strong>Variables panel hint</strong>{" "}
                                (gap-08-adjacent): when a user types{" "}
                                <code>{"{{geo.region}}"}</code>, autocomplete
                                shows both candidates with the chip
                                distinguishing them.
                            </li>
                        </ul>
                        <br />
                        <strong>Two shapes resolve differently:</strong>
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
                        Marking the structural difference in the UI is what
                        prevents authoring bugs.
                    </>
                }
            >
                <Link href="/solutions-drill-in" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>
                        Solutions · Drill-in — full demo →
                    </span>
                    <span style={styles.ctaBlurb}>
                        The kitchen-sink Vanuatu row has both literal{" "}
                        <code>&quot;geo.region&quot;</code> and nested{" "}
                        <code>geo</code>; the literal field shows{" "}
                        <code>[dotted-key]</code> + <code>[⚠ collision]</code>;
                        the nested sibling shows <code>[⚠ collision]</code>.
                        Detection runs automatically on any row with this
                        shape.
                    </span>
                </Link>

                <div style={styles.crossLinks}>
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-01-type-chips" style={styles.link}>
                        gap-01 (chip vocabulary — gap-05's chips live there)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-04-shape-preservation" style={styles.link}>
                        gap-04 (save-side filter prevents shadowing on save)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-07-schema-aware-form" style={styles.link}>
                        gap-07 (schema-aware form does most of the
                        disambiguation work structurally — Braintrust pattern)
                    </Link>{" "}
                    ·{" "}
                    <Link
                        href="/gap-08-playground-variable-validation"
                        style={styles.link}
                    >
                        gap-08 (variable validation — the autocomplete needs
                        the same dot-key disambiguation)
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
