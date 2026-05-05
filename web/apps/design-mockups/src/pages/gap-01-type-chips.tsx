/**
 * Gap 01 — Type chip system (concept page).
 *
 * Problem statement + chip vocabulary legend + type-switching mechanism
 * explainer. Surface-specific demos live on sub-pages:
 *   - /gap-01-drill-in — chips on the testcase drawer
 *   - /gap-01-playground — chips on playground execution items
 *   - /gap-01-tables — chips on testset table cells
 *
 * The previous monolithic gap-01 page conflated all three surface demos with
 * the conceptual problem; restructured 2026-05-04 because the page title
 * "Type chips on the drill-in field header" no longer described the body.
 */

import Head from "next/head"
import Link from "next/link"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"
import {
    TypeChip,
    type ChipVariant,
} from "@/mockups/components/proposed/TypeChip"

const CHIP_LEGEND: {
    variant: ChipVariant
    meaning: string
    example: string
}[] = [
    {variant: "string", meaning: "Plain string value", example: '"Kiribati"'},
    {variant: "number", meaning: "Numeric scalar", example: "45"},
    {variant: "boolean", meaning: "Boolean scalar", example: "true"},
    {variant: "null", meaning: "Authored null", example: "null"},
    {
        variant: "json-object",
        meaning: "Parsed object value",
        example: "{ region, lat, lng }",
    },
    {
        variant: "json-array",
        meaning: "Parsed array value",
        example: "[en, gil]",
    },
    {
        variant: "messages",
        meaning: "Messages-shaped array (role/content)",
        example: "[3 msgs]",
    },
    {
        variant: "tool",
        meaning: "Tool-call object",
        example: "{ name, arguments }",
    },
    {
        variant: "stringified",
        meaning:
            "JSON value stored as a string — `json-str` spells out the conflict (JSON shape, string storage). Distinct from [obj] / [arr] which mark *parsed* values. Surfaces the gap-02/04 fault line.",
        example: '\'{"source":"trace",...}\'',
    },
    {
        variant: "long-str",
        meaning:
            "Editor-mode chip for long-form / markdown string content (Lexical SharedEditor with markdown preview toggle). Distinct from [str] (single-line antd Input). Default chosen at hydration via length heuristic; user toggles via the chip popover.",
        example: "626 chars · 24 lines",
    },
    {
        variant: "dotted-key",
        meaning: "Literal dotted top-level key, distinct from a nested path",
        example: '"geo.region"',
    },
    {
        variant: "collision",
        meaning: "Both literal-dot and nested form exist on the same row",
        example: "[geo.region] + [geo > region]",
    },
    {
        variant: "mixed",
        meaning: "Column has heterogeneous types across rows",
        example: "string in row A, object in row B",
    },
    {
        variant: "not-authored",
        meaning: "Union-projected key (gap-04)",
        example: "—",
    },
    {
        variant: "shadowed",
        meaning: "Literal-key resolution silently overrides nested",
        example: "literal wins",
    },
    {
        variant: "path",
        meaning: "JSONPath reference target",
        example: "$.input.country",
    },
]

export default function Gap01Concept() {
    return (
        <>
            <Head>
                <title>Gap 01 — Type chip system</title>
            </Head>
            <MockupPageShell
                title="Gap 01 — Type chip system"
                blurb={
                    "What chips are, why we need a vocabulary, how it propagates across surfaces. Conceptual page — surface-specific demos (drill-in / playground / tables) live on sub-pages linked below."
                }
                notes={
                    <>
                        <strong>Problem:</strong> users can't tell what TYPE a
                        value is by looking at the rendered editor or table cell.
                        A short string and a number both render as text. An empty
                        string and null both render as nothing. A stringified
                        JSON blob renders identically to a regular long string.
                        Production today doesn't surface a type indicator
                        anywhere — the user has to read the value carefully or
                        infer from context.
                        <br />
                        <br />
                        <strong>Proposal:</strong> a small monospace chip per
                        field (
                        <code>[str]</code> · <code>[num]</code> ·{" "}
                        <code>[obj]</code> · <code>[arr]</code> ·{" "}
                        <code>[bool]</code> · <code>[null]</code> ·{" "}
                        <code>[msgs]</code> · <code>[json-str]</code> · …) that
                        appears next to the field name on every surface that
                        renders user-authored data: testcase drawer, playground
                        execution items, testset table cells, observability /
                        eval result views. Same primitive (
                        <code>TypeChip</code>) everywhere. Same vocabulary. Same
                        rendering modes (All / Ambiguous-only / None) so the
                        team can dial the visibility per project.
                        <br />
                        <br />
                        <strong>The chip is also the convert action.</strong>{" "}
                        Clicking a chip opens a popover with the contextually
                        valid type conversions (RFC WP-F1: "type indicator next
                        to each value" + "convert action between string and
                        JSON" — collapsed into one affordance). For string-like
                        chips, the popover also offers an editor-mode toggle
                        between short-form (inline antd Input) and long-form
                        (Lexical SharedEditor with markdown preview), making
                        the markdown affordance discoverable without the user
                        having to know it exists. See the surface-specific
                        sub-pages for live demos.
                    </>
                }
            >
                <section style={styles.subPagesSection}>
                    <h2 style={styles.h2}>See it in action — solution pages</h2>
                    <p style={styles.lead}>
                        The chip vocabulary is one of several proposals (gap-01
                        through gap-08). Each gap page is conceptual — problem
                        statement + proposed solution. The integrated
                        experience lives on three <strong>solution pages</strong>{" "}
                        that mount every relevant proposal together per surface.
                    </p>
                    <div style={styles.subPagesGrid}>
                        <Link
                            href="/solutions-drill-in"
                            style={styles.subPageCard}
                        >
                            <span style={styles.subPageTag}>Solution</span>
                            <span style={styles.subPageTitle}>
                                Solutions · Drill-in →
                            </span>
                            <span style={styles.subPageBlurb}>
                                Drawer mounted on the kitchen-sink Vanuatu
                                row — every chip variant on a single row,
                                plus gap-03 auto-expand, gap-05 collision
                                detection, gap-06 chat cards, and the
                                long-form / markdown editor on{" "}
                                <code>correct_answer</code>.
                            </span>
                        </Link>
                        <Link
                            href="/solutions-playground"
                            style={styles.subPageCard}
                        >
                            <span style={styles.subPageTag}>Solution</span>
                            <span style={styles.subPageTitle}>
                                Solutions · Playground →
                            </span>
                            <span style={styles.subPageBlurb}>
                                Three-way compare grid (Today / Proposed
                                embedded / Alt compact) on the kitchen-sink
                                Vanuatu row. Every chip variant on inputs,
                                long-form mode on{" "}
                                <code>correct_answer</code>, output
                                mode-switching on the response.
                            </span>
                        </Link>
                        <Link
                            href="/solutions-tables"
                            style={styles.subPageCard}
                        >
                            <span style={styles.subPageTag}>Solution</span>
                            <span style={styles.subPageTitle}>
                                Solutions · Tables →
                            </span>
                            <span style={styles.subPageBlurb}>
                                Three-row kitchen-sink testset (Vanuatu /
                                Tuvalu / Kiribati). Covers gap-01 chips on
                                every column header, gap-02 cell rendering,
                                gap-04 em-dash for missing keys, gap-05
                                collisions, gap-06 messages preview.
                            </span>
                        </Link>
                    </div>
                </section>

                <section style={styles.legendSection}>
                    <header style={styles.legendHeader}>
                        <h2 style={styles.h2}>Chip vocabulary</h2>
                        <p style={styles.lead}>
                            Full set of variants the <code>TypeChip</code>{" "}
                            primitive supports. Used across gap-01 (drill-in /
                            playground / tables) plus gap-02 / gap-03 / gap-05 /
                            gap-06.
                        </p>
                    </header>
                    <ul style={styles.legendList}>
                        {CHIP_LEGEND.map((row) => (
                            <li key={row.variant} style={styles.legendItem}>
                                <span style={styles.chipCol}>
                                    <TypeChip variant={row.variant} />
                                </span>
                                <span style={styles.meaningCol}>
                                    {row.meaning}
                                </span>
                                <code style={styles.exampleCol}>
                                    {row.example}
                                </code>
                            </li>
                        ))}
                    </ul>
                </section>

                <section style={styles.mechanismSection}>
                    <header style={styles.legendHeader}>
                        <h2 style={styles.h2}>
                            Type switching via chips (RFC WP-F1 mechanism)
                        </h2>
                        <p style={styles.lead}>
                            Clicking a chip opens a popover with two sections.
                            Both are real, working features — try them on any
                            sub-page demo.
                        </p>
                    </header>
                    <div style={styles.mechanismGrid}>
                        <div style={styles.mechanismCol}>
                            <div style={styles.mechanismTitle}>
                                Convert type
                            </div>
                            <ul style={styles.mechanismList}>
                                <li>
                                    <strong>string → obj/arr</strong>: parse
                                    when JSON-shaped. <strong>number/bool</strong>
                                    : convert when value matches.
                                </li>
                                <li>
                                    <strong>number → string</strong>: stringify.
                                    <strong> obj/arr → string</strong>: serialize
                                    via JSON.stringify.
                                </li>
                                <li>
                                    <strong>null → anything</strong>: initialize
                                    as the chosen type with a sensible default.
                                </li>
                                <li>
                                    Lossy / destructive conversions surface a{" "}
                                    <em>warning row</em> in the menu before
                                    they execute, so the user can see what
                                    they'll lose before clicking.
                                </li>
                            </ul>
                        </div>
                        <div style={styles.mechanismCol}>
                            <div style={styles.mechanismTitle}>Editor mode</div>
                            <ul style={styles.mechanismList}>
                                <li>
                                    <strong>string fields</strong>: switch
                                    between short-form (inline antd Input) and
                                    long-form (Lexical SharedEditor with
                                    markdown preview). Value doesn't change —
                                    only how it's displayed/edited.
                                </li>
                                <li>
                                    Initial mode chosen at <em>hydration only</em>{" "}
                                    via length heuristic (
                                    <code>&gt; 100 chars</code> or contains
                                    newlines → <code>long</code>). After mount,
                                    only the chip popover changes mode — typing
                                    doesn't auto-flip.
                                </li>
                                <li>
                                    <strong>Notification badge</strong>: when
                                    typing crosses the threshold while in{" "}
                                    <code>short</code> mode, a small purple dot
                                    pulses on the chip suggesting the switch.
                                </li>
                                <li>
                                    Clicking "Switch to long-form editor"
                                    auto-focuses the Lexical editor on mount —
                                    no focus break.
                                </li>
                            </ul>
                        </div>
                    </div>
                    <div style={styles.notes}>
                        <strong>Implementation:</strong>{" "}
                        <code>ChipConversionPopover.tsx</code> wraps any{" "}
                        <code>TypeChip</code>. <code>getConversions()</code>{" "}
                        computes contextually-valid type conversions from the
                        current variant + value;{" "}
                        <code>getModeSwitches()</code> adds the editor-mode
                        toggle for string-like chips. The popover renders both
                        sections under labels (
                        <code>Convert type:</code> /{" "}
                        <code>Editor mode:</code>) so the two concerns stay
                        distinct visually.{" "}
                        <strong>Phase 2 (not built yet):</strong> correctness
                        chips (<code>[⚠ collision]</code>,{" "}
                        <code>[⚠ shadowed]</code>, <code>[mixed]</code>,{" "}
                        <code>[dotted-key]</code>) get their own action menus —
                        "resolve to literal", "lock column type", etc. Same
                        primitive, different menu.
                    </div>
                </section>
            </MockupPageShell>
        </>
    )
}

const styles = {
    h2: {fontSize: 14, fontWeight: 700, margin: "0 0 4px", color: "#051729"},
    lead: {
        fontSize: 12,
        color: "rgba(5, 23, 41, 0.65)",
        lineHeight: 1.6,
        margin: 0,
    },
    link: {color: "#1677ff", fontWeight: 500},

    subPagesSection: {
        padding: 16,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
    },
    subPagesGrid: {
        marginTop: 12,
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 12,
    },
    subPageCard: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 6,
        padding: "12px 14px",
        background: "#fafafa",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        textDecoration: "none",
        color: "#051729",
        transition: "border-color 0.1s, background 0.1s",
    },
    subPageTag: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 6px",
        borderRadius: 4,
        background: "rgba(5, 23, 41, 0.06)",
        color: "rgba(5, 23, 41, 0.65)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        alignSelf: "flex-start" as const,
    },
    subPageTitle: {
        fontSize: 13,
        fontWeight: 600,
        color: "#1677ff",
    },
    subPageBlurb: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.65)",
        lineHeight: 1.5,
    },

    legendSection: {
        marginTop: 24,
        padding: 16,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
    },
    legendHeader: {marginBottom: 12},
    legendList: {
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "grid",
        gap: 6,
    },
    legendItem: {
        display: "grid",
        gridTemplateColumns: "120px 1fr 200px",
        gap: 12,
        alignItems: "center",
        padding: "6px 0",
        borderBottom: "1px solid rgba(5, 23, 41, 0.04)",
    },
    chipCol: {display: "inline-flex"},
    meaningCol: {
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.5,
    },
    exampleCol: {
        fontSize: 11,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "rgba(5, 23, 41, 0.55)",
        whiteSpace: "nowrap" as const,
        overflow: "hidden" as const,
        textOverflow: "ellipsis" as const,
    },

    mechanismSection: {
        marginTop: 24,
        padding: 16,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
    },
    mechanismGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 16,
        marginTop: 12,
    },
    mechanismCol: {
        padding: 12,
        background: "#fafafa",
        borderRadius: 6,
        border: "1px solid rgba(5, 23, 41, 0.06)",
    },
    mechanismTitle: {
        fontSize: 12,
        fontWeight: 600,
        color: "#051729",
        marginBottom: 6,
    },
    mechanismList: {
        margin: "4px 0 0",
        paddingLeft: 18,
        fontSize: 12,
        lineHeight: 1.6,
        color: "#051729",
    },
    notes: {
        marginTop: 12,
        padding: "10px 14px",
        background: "#f0f9ff",
        borderLeft: "3px solid #1677ff",
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.6,
        borderRadius: "0 4px 4px 0",
    },
}
