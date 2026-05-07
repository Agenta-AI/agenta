/**
 * Gap 09 — Variable provenance + usage state in the playground execution item.
 *
 * Surfaced 2026-05-05. Each variable in the execution item carries a 2-axis
 * state: authoring side (on the testcase, or a draft from prompt typing not
 * yet synced) and usage side (referenced by every prompt, by some prompts
 * in a chain, or by none). Today's playground renders all variables
 * identically; this gap proposes a "Variable map" section with four
 * distinguished states.
 *
 * Live demo: /solutions-playground (gap-09 section above the kitchen-sink
 * compare grid).
 *
 * Composes with: gap-04 (union projection at the testcase level), gap-07
 * (schema-aware form, raises the ceiling), gap-08 (symmetric edit-time
 * check on the prompt surface).
 */

import Head from "next/head"
import Link from "next/link"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"

export default function Gap09Concept() {
    return (
        <>
            <Head>
                <title>Gap 09 — Variable provenance + usage state</title>
            </Head>
            <MockupPageShell
                title="Gap 09 — Variable provenance + usage state in the playground execution item"
                blurb={
                    "Surfaced 2026-05-05. Each variable in the execution item has a 2-axis state — authoring (on the testcase, or a draft pending sync) × usage (referenced by every prompt, by some prompts in a chain, or by none). Today's playground renders all variables identically. The proposed Variable map collapses unused variables, marks drafts with a dashed border, and shows chain scope per row."
                }
                notes={
                    <>
                        <strong>What's broken today:</strong> the playground execution item shows
                        every variable on the testcase identically, regardless of whether any prompt
                        references it, and shows nothing for variables typed into prompts that
                        aren't on the testcase yet. In chain/multi-prompt configs, the user can't
                        tell which prompts use which variables. Result: the inputs panel gets
                        crowded with unused testcase columns, prompt-typed variables disappear into
                        the void until the next save, and chain debugging requires reading every
                        prompt template to figure out which variable feeds where.
                        <br />
                        <br />
                        <strong>The four states:</strong>
                        <ul style={styles.list}>
                            <li>
                                <code>used</code> — referenced by ≥1 prompt + on the testcase.
                                Default rendering, no extra chip.
                            </li>
                            <li>
                                <code>chain</code> — used by some prompts in the chain but not all.
                                Carries a <code>prompt 1, 3 of 4</code> badge so the user sees where
                                it lands without reading every template.
                            </li>
                            <li>
                                <code>draft</code> — referenced by ≥1 prompt but NOT on the testcase
                                yet. Lives in the local draft until explicit sync. Dashed
                                pink-border + <code>[draft]</code> chip; an inline hint reads{" "}
                                <em>"not on testcase yet · syncs on save"</em>.
                            </li>
                            <li>
                                <code>unused</code> — on the testcase but no prompt in the chain
                                references it. Collapsed under a "Show N unused variables" toggle by
                                default — visible if you want them, out of the way when you don't.
                            </li>
                        </ul>
                        <br />
                        <strong>Why this is its own gap:</strong> gap-08 catches "referenced and
                        missing" at edit time on the prompt surface. Gap-04 surfaces the
                        testcase-level union of authored vs not. <em>This</em> gap composes both at
                        the playground execution-item level — the symmetric "authored and unused"
                        case + per-prompt chain scope are unique to this surface. Without it, the
                        playground inputs panel scales poorly to testsets with many columns and
                        chain configs.
                        <br />
                        <br />
                        <strong>How gap-07 changes this:</strong> when a per-testset schema entity
                        exists, "authored vs draft" comes from the schema directly, not from
                        inference. Without gap-07, "draft" is a best-effort guess (prompt references
                        this name, row doesn't have it) and may mis-classify legitimate optional
                        columns.
                        <br />
                        <br />
                        <strong>Visual budget:</strong> the playground execution item is already
                        busy. Default settings keep the noise low — unused variables collapsed,
                        chain badges only when scope is partial (a variable used by every prompt
                        gets no badge), draft border only on draft rows. The "Show unused" toggle
                        gives power users full visibility on demand.
                    </>
                }
            >
                <Link href="/solutions-playground" style={styles.cta}>
                    <span style={styles.ctaTag}>Solution</span>
                    <span style={styles.ctaTitle}>
                        Solutions · Playground — Variable map demo →
                    </span>
                    <span style={styles.ctaBlurb}>
                        Above the kitchen-sink compare grid. Demonstrates the four states on
                        Vanuatu's variables: country + messages as <code>used</code>, geo +
                        languages as <code>chain</code> (with prompt-scope badges),{" "}
                        <code>iso_code</code> as <code>draft</code> (typed into a prompt but not on
                        the testcase), and 6 testcase columns as <code>unused</code> (collapsed
                        behind a toggle).
                    </span>
                </Link>

                <div style={styles.crossLinks}>
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-04-shape-preservation" style={styles.link}>
                        gap-04 (union projection — same shape at the testcase level)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-07-schema-aware-form" style={styles.link}>
                        gap-07 (schema entity disambiguates authored vs draft)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-08-playground-variable-validation" style={styles.link}>
                        gap-08 (symmetric edit-time check on the prompt surface)
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
        background: "#f0f5ff",
        border: "1px solid #1d39c4",
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
        background: "#1d39c4",
        color: "white",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        alignSelf: "flex-start" as const,
    },
    ctaTitle: {fontSize: 14, fontWeight: 700, color: "#10239e"},
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
