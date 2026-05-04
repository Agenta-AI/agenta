import Head from "next/head"
import Link from "next/link"

const gaps = [
    {
        slug: "gap-01-type-chips",
        title: "Gap 01 — Type chip system",
        blurb:
            "Concept: problem statement, chip vocabulary legend, type-switching mechanism (RFC WP-F1). Integrated experience lives on the three solution pages.",
        status: "ready",
    },
    {
        slug: "gap-02-table-cells",
        title: "Gap 02 — Table cells",
        blurb: "View-only entry point. Apply chips to collapsed cells, arrays, mixed-type columns.",
        status: "ready",
    },
    {
        slug: "gap-03-drill-in-root-view",
        title: "Gap 03 — Drill-in root view",
        blurb: "Auto-expand top-level keys in DrillInContent. Drawer + playground inherit.",
        status: "ready",
    },
    {
        slug: "gap-04-shape-preservation",
        title: "Gap 04 — Shape preservation",
        blurb:
            "Mark union-projected fields visually distinct. Bound the JSON-edit save path.",
        status: "ready",
    },
    {
        slug: "gap-05-dot-key-disambiguation",
        title: "Gap 05 — Dot-key disambiguation",
        blurb: "Literal-key-first behavior must be visible. Collision warning for the Vanuatu case.",
        status: "ready",
    },
    {
        slug: "gap-06-messages-renderer",
        title: "Gap 06 — Messages renderer",
        blurb:
            "Lift ChatMessageEditor auto-detection so BeautifiedJsonView + JsonEditorWithLocalState render messages consistently.",
        status: "ready",
    },
    {
        slug: "gap-07-schema-aware-form",
        title: "Gap 07 — Schema-aware Edit form",
        blurb:
            "Surfaced 2026-05-04 by competitive analysis. Per-testset field schema becomes a first-class entity; drill-in renders as a labelled form with type-aware inputs per column. Cross-cutting: subsumes gap-03 + chunks of gap-04 / gap-05 / gap-01.",
        status: "competitive",
    },
    {
        slug: "gap-08-playground-variable-validation",
        title: "Gap 08 — Playground variable validation",
        blurb:
            "Surfaced 2026-05-04 by competitive analysis. Banner on dataset-attach naming canonical references; per-variable tooltip when a referenced path doesn't resolve in the attached testset's schema. Edit-time check, not runtime.",
        status: "competitive",
    },
    {
        slug: "solutions-drill-in",
        title: "Solutions · Drill-in",
        blurb:
            "Unified drawer demo. Production DrillInContent vs ProposedDrillIn with every drawer-related proposal applied (gap-01 chips, gap-03 auto-expand, gap-05 collision, gap-06 chat cards, long-form / markdown). Fixture switcher exercises each gap.",
        status: "solution",
    },
    {
        slug: "solutions-playground",
        title: "Solutions · Playground",
        blurb:
            "Unified execution-item demo. Three-way compare across Today / Proposed embedded / Alt compact, with three fixture rows covering chip-showcase, messages + tools, and the markdown article (long-form mode).",
        status: "solution",
    },
    {
        slug: "solutions-tables",
        title: "Solutions · Tables",
        blurb:
            "Unified testset cell demo. Production TestcaseCellContent vs ProposedTableCell on a fixture grid covering gap-01 chips, gap-02 cell rendering, gap-04 missing keys, gap-05 collisions, gap-06 messages preview. Each row tagged with its gap.",
        status: "solution",
    },
    {
        slug: "alt-tree-pane",
        title: "Alt — Two-pane tree + detail",
        blurb:
            "Paradigmatically different alternative to the card-stack drill-in. Compact tree on the left, editor on the right. Wins on deeply-nested + messages fixtures; threshold-fallback hybrid is the real shipping shape. Surfaced 2026-05-04 by alternative-design exploration.",
        status: "alternative",
    },
    {
        slug: "molecule-drill-in",
        title: "Appendix — Tier comparison",
        blurb:
            "OSS DrillInContent (1581 lines, monolithic) vs package MoleculeDrillInView (Tier 1+2, DI + slots + schema-aware). Same testcase, side by side, with a props-divergence breakdown.",
        status: "ready",
    },
] as const

export default function Index() {
    return (
        <>
            <Head>
                <title>JSON ↔ String UX · Design Mockups</title>
            </Head>
            <main style={styles.main}>
                <header style={styles.header}>
                    <h1 style={styles.h1}>JSON ↔ String UX — Design Mockups</h1>
                    <p style={styles.lead}>
                        Real React mockups using the actual drill-in components from
                        <code style={styles.code}> @agenta/oss</code>,{" "}
                        <code style={styles.code}>@agenta/ui</code>, and{" "}
                        <code style={styles.code}>@agenta/entity-ui</code>. Each page below
                        mounts the same component the production app uses, against stub
                        data, so we can iterate the design with full fidelity.
                    </p>
                    <p style={styles.lead}>
                        Companion HTML wireframes:{" "}
                        <a
                            href="../../../docs/designs/json-string-ux/variants/index.html"
                            style={styles.link}
                        >
                            docs/designs/json-string-ux/variants/index.html
                        </a>
                    </p>
                </header>

                <section style={styles.competitive}>
                    <div style={styles.competitiveHeader}>
                        <span style={styles.competitiveTag}>Competitive</span>
                        <strong style={styles.competitiveTitle}>
                            2026-05-04 audit: Braintrust + Langfuse running our 8 fixtures
                        </strong>
                    </div>
                    <p style={styles.lead}>
                        50 screenshots, both products exercised against
                        <code style={styles.code}>01-flat-strings.json</code> through{" "}
                        <code style={styles.code}>08-dot-key-collision.json</code>. Surfaced
                        two new candidate gaps (07, 08 below) and revised the priority
                        order. Read the full analysis at{" "}
                        <a
                            href="../../../docs/designs/json-string-ux/competitive-analysis.md"
                            style={styles.link}
                        >
                            docs/designs/json-string-ux/competitive-analysis.md
                        </a>
                        .
                    </p>
                    <ul style={styles.compList}>
                        <li>
                            <strong>Schema-as-entity is the moat</strong> (Braintrust). Per-testset
                            field schema reused across drill-in form, edit-time validation, and
                            playground variable resolution. One investment, four payoffs.
                        </li>
                        <li>
                            <strong>JSON-as-opaque is the floor</strong> (Langfuse). Polished JSON
                            editor in a modal; no form, no validation, no schema. Lower complexity,
                            lower ceiling.
                        </li>
                        <li>
                            <strong>We go past both on three dimensions</strong>: gap-02 stringified-JSON
                            detection, gap-04 projection toggle, gap-06 chat / tool-call cards. Don't
                            deprioritize these.
                        </li>
                        <li>
                            <strong>Near-zero-cost stop-gap</strong>: full-row pretty-JSON popover
                            on row click (Braintrust's Mode 3). Buys 80% of "let me see the whole
                            thing" while gap-07 schema-aware form is being built.
                        </li>
                    </ul>
                </section>

                <ol style={styles.list}>
                    {gaps.map((gap) => (
                        <li key={gap.slug} style={styles.item}>
                            <div style={styles.itemHeader}>
                                <Link href={`/${gap.slug}`} style={styles.itemLink}>
                                    {gap.title}
                                </Link>
                                <span
                                    style={{
                                        ...styles.statusChip,
                                        ...(gap.status === "ready"
                                            ? styles.statusReady
                                            : gap.status === "competitive"
                                              ? styles.statusCompetitive
                                              : gap.status === "alternative"
                                                ? styles.statusAlternative
                                                : gap.status === "solution"
                                                  ? styles.statusSolution
                                                  : styles.statusPlanned),
                                    }}
                                >
                                    {gap.status}
                                </span>
                            </div>
                            <p style={styles.itemBlurb}>{gap.blurb}</p>
                        </li>
                    ))}
                </ol>

                <section style={styles.componentMap}>
                    <h2 style={styles.h2}>Component map</h2>
                    <p style={styles.lead}>
                        Each mockup mounts one or more of these real components:
                    </p>
                    <ul style={styles.compList}>
                        <li>
                            <code style={styles.code}>DrillInContent</code> — the workhorse
                            (web/oss/src/components/DrillInView/DrillInContent.tsx:178)
                        </li>
                        <li>
                            <code style={styles.code}>DrillInFieldHeader</code> — per-field
                            row, type chip, view-mode selector, copy, collapse
                            (DrillInFieldHeader.tsx:209)
                        </li>
                        <li>
                            <code style={styles.code}>EntityDualViewEditor</code> — Fields ↔
                            JSON toggle wrapper (EntityDualViewEditor.tsx:71)
                        </li>
                        <li>
                            <code style={styles.code}>TestcaseDrillInView</code> — testcase
                            specializer (TestcaseDrillInView.tsx:47)
                        </li>
                        <li>
                            <code style={styles.code}>TraceSpanDrillInView</code> — trace
                            span specializer with two render paths
                            (TraceSpanDrillInView.tsx:279)
                        </li>
                    </ul>
                </section>
            </main>
        </>
    )
}

const styles = {
    main: {
        maxWidth: 960,
        margin: "0 auto",
        padding: "32px 24px",
        color: "#051729",
    },
    header: {marginBottom: 32},
    h1: {fontSize: 24, fontWeight: 700, margin: "0 0 8px"},
    h2: {fontSize: 16, fontWeight: 700, margin: "0 0 8px"},
    lead: {
        fontSize: 13,
        color: "rgba(5, 23, 41, 0.65)",
        lineHeight: 1.6,
        maxWidth: 800,
        margin: "4px 0",
    },
    code: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
        background: "rgba(5, 23, 41, 0.04)",
        padding: "1px 6px",
        borderRadius: 4,
    },
    link: {color: "#1677ff"},
    list: {
        listStyle: "none",
        padding: 0,
        margin: "16px 0 32px",
        display: "grid",
        gap: 8,
    },
    item: {
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        padding: "12px 16px",
    },
    itemHeader: {
        display: "flex",
        alignItems: "center",
        gap: 8,
    },
    itemLink: {
        color: "#1677ff",
        fontWeight: 600,
        textDecoration: "none",
    },
    itemLinkDisabled: {
        color: "rgba(5, 23, 41, 0.45)",
        fontWeight: 600,
    },
    itemBlurb: {
        fontSize: 12,
        color: "rgba(5, 23, 41, 0.65)",
        margin: "4px 0 0",
        lineHeight: 1.6,
    },
    statusChip: {
        marginLeft: "auto",
        fontSize: 10,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        padding: "2px 6px",
        borderRadius: 4,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
    },
    statusReady: {
        background: "#f6ffed",
        color: "#389e0d",
    },
    statusPlanned: {
        background: "rgba(5, 23, 41, 0.06)",
        color: "rgba(5, 23, 41, 0.55)",
    },
    statusCompetitive: {
        background: "#fff1b8",
        color: "#874d00",
    },
    statusAlternative: {
        background: "#f9f0ff",
        color: "#722ed1",
    },
    statusSolution: {
        background: "#e6fffb",
        color: "#13c2c2",
    },
    competitive: {
        marginBottom: 24,
        padding: 16,
        background: "#fffbe6",
        border: "1px solid #faad14",
        borderRadius: 8,
    },
    competitiveHeader: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 8,
    },
    competitiveTag: {
        flexShrink: 0,
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        background: "#fff1b8",
        color: "#874d00",
    },
    competitiveTitle: {
        fontSize: 13,
        color: "#051729",
    },
    componentMap: {
        marginTop: 32,
        padding: 16,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
    },
    compList: {
        margin: "8px 0 0",
        paddingLeft: 20,
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.8,
    },
}
