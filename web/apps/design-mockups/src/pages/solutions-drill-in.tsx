/**
 * Solutions · Drill-in — testcase drawer experiments.
 *
 * Three side-by-side comparisons stacked vertically, each comparing the
 * production testcase drawer (Status quo, left) with a different design
 * candidate (Proposal, right). All three rows use the same testcase data,
 * so the only thing that changes between rows is the right-hand candidate.
 *
 *   Row 1 — Original proposal: ProposedDrillIn with every drawer-related
 *           change applied (type chips, auto-expand, dotted-key handling,
 *           inline messages/tool-call rendering).
 *
 *   Row 2 — New proposal (you are here): empty starting point. Copy of
 *           the status quo so the design conversation can move forward
 *           with a clean column.
 *
 *   Row 3 — Schema-aware form alternative: when a per-testset schema is
 *           authored, the drawer renders a labelled form instead of
 *           detection-driven cards.
 *
 * Each row sits below a yellow lead paragraph that explains the proposal
 * in plain English. Drawer width matches the production `size="large"`
 * antd Drawer (~736px); the row scrolls horizontally if the viewport is
 * narrower than two drawers side-by-side.
 */

import {useState, type ReactNode} from "react"

import Head from "next/head"
import Link from "next/link"

import {Segmented} from "antd"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"
import {ProdTestcaseDrawerSurface} from "@/mockups/components/ProdTestcaseDrawerSurface"
import {StubDrillIn} from "@/mockups/components/StubDrillIn"
import {ProposalV2DrillIn} from "@/mockups/components/proposed/ProposalV2DrillIn"
import {ProposedDrillIn, type ChipRenderMode} from "@/mockups/components/proposed/ProposedDrillIn"
import {
    FIXTURE_KITCHEN_SINK_INFERRED_SCHEMA,
    SchemaForm,
} from "@/mockups/components/proposed/SchemaForm"
import {
    fixture_kitchen_sink,
    fixture_kitchen_sink_known_columns,
} from "@/mockups/data/stubTestcases"

export default function SolutionsDrillIn() {
    const [editMode, setEditMode] = useState<"editable" | "read-only">("editable")
    const [chipMode, setChipMode] = useState<ChipRenderMode>("all")
    const editable = editMode === "editable"

    const tc = fixture_kitchen_sink[0]
    const schema = FIXTURE_KITCHEN_SINK_INFERRED_SCHEMA

    const statusQuoColumn = (key: string) => (
        <ComparisonColumn label="Status quo" tone="today">
            <ProdTestcaseDrawerSurface>
                {/* Production-faithful wrapper — mirrors
                    web/oss/.../TestcaseEditDrawer/index.tsx so padding and
                    add/delete affordances match the real testcase drawer. */}
                <div className="flex flex-col h-full overflow-hidden w-full [&_.drill-in-breadcrumb]:pl-4 [&_.drill-in-field-content]:px-4 [&_.drill-in-field-content]:pt-2">
                    <StubDrillIn
                        key={`${key}-today`}
                        initialData={tc.data}
                        rootTitle="Root"
                        editable={editable}
                        showFieldDrillIn
                        showFieldCollapse
                        showAddControls
                        showDeleteControls
                    />
                </div>
            </ProdTestcaseDrawerSurface>
        </ComparisonColumn>
    )

    return (
        <>
            <Head>
                <title>Solutions · Drill-in — testcase drawer experiments</title>
            </Head>
            <MockupPageShell
                title="Solutions · Drill-in (testcase drawer)"
                blurb={
                    "Three rows. Each row pairs the production testcase drawer (Status " +
                    "quo, left) with a different design proposal (Proposal, right). All " +
                    "rows render the same testcase data, so the only thing that changes " +
                    "between rows is the proposal on the right. Drawer width matches the " +
                    'production `size="large"` antd Drawer (~736px) so the comparison ' +
                    "reads at production fidelity; horizontal scroll inside the row if your " +
                    "viewport is narrower than two drawers side-by-side."
                }
            >
                <div style={styles.toolbar}>
                    <span style={styles.label}>Drawer mode:</span>
                    <Segmented
                        size="small"
                        value={editMode}
                        options={[
                            {label: "Editable", value: "editable"},
                            {label: "Read only", value: "read-only"},
                        ]}
                        onChange={(v) => setEditMode(v as "editable" | "read-only")}
                    />
                    <span style={styles.divider} />
                    <span style={styles.label}>Type chip visibility:</span>
                    <Segmented
                        size="small"
                        value={chipMode}
                        options={[
                            {label: "All", value: "all"},
                            {label: "Ambiguous-only", value: "ambiguous-only"},
                            {label: "None", value: "none"},
                        ]}
                        onChange={(v) => setChipMode(v as ChipRenderMode)}
                    />
                </div>

                {/* Row 1 — original proposal that was already on this page
                    when we started. Bundles every drawer-related change
                    (chips, auto-expand, dotted-key handling, inline
                    messages/tool-call rendering) on a single fixture so
                    reviewers can see them composed. */}
                <ExperimentRow
                    title="Proposal · Original (chips + auto-expand + inline messages)"
                    lead={
                        "The first design we drafted. Adds a small type chip beside every " +
                        "field name (click to change type / editor mode), auto-expands " +
                        "nested objects inline so the drawer doesn't open on a wall of " +
                        "JSON, renders chat messages and tool calls as cards instead of " +
                        "raw arrays, and flags fields whose name contains a literal dot " +
                        "(so users can tell `geo.region` the literal key apart from " +
                        "`geo` → `region` the nested path). One fixture row triggers all of " +
                        "these at once so you can see the full effect."
                    }
                    statusQuo={statusQuoColumn("row-1")}
                    proposal={
                        <ComparisonColumn label="Proposal" tone="proposed">
                            <ProdTestcaseDrawerSurface>
                                <div className="flex flex-col h-full overflow-hidden w-full">
                                    <ProposedDrillIn
                                        key="row-1-proposed"
                                        data={tc.data}
                                        rootTitle={tc.label}
                                        autoExpand
                                        detectDotKeyCollisions
                                        editable={editable}
                                        chipMode={chipMode}
                                        knownColumns={fixture_kitchen_sink_known_columns}
                                    />
                                </div>
                            </ProdTestcaseDrawerSurface>
                        </ComparisonColumn>
                    }
                />

                {/* Row 2 — empty starting point for the next round of design
                    work. Renders the same status-quo drawer on the right so
                    we can iteratively replace bits of it with new proposals.
                    Edit this column directly when you have something to try. */}
                <ExperimentRow
                    title="Proposal · New (per-field view-type dropdown)"
                    lead={
                        "Each field in the drawer becomes its own section. The header " +
                        "shows just the field name and a single “View as ▾” " +
                        "dropdown on the right — no more row of icons (drill-in " +
                        "chevron, copy, raw toggle, view-mode select). The dropdown lets " +
                        "the user pick how the value is rendered: Text or Markdown for " +
                        "strings; Chat for messages-shaped arrays; Form for objects; JSON " +
                        "and YAML are always available. The Form view drops the " +
                        "card-inside-card pattern — nesting is shown as an indent " +
                        "with a thin vertical rail instead of another card. The JSON / " +
                        "YAML editors render with a white gutter so the drawer reads as " +
                        "one continuous surface."
                    }
                    statusQuo={statusQuoColumn("row-2")}
                    proposal={
                        <ComparisonColumn
                            label="Proposal"
                            tone="proposed"
                            sub="Per-field view-type dropdown"
                        >
                            <ProdTestcaseDrawerSurface>
                                <ProposalV2DrillIn
                                    key="row-2-proposed-v2"
                                    data={tc.data}
                                    editable={editable}
                                />
                            </ProdTestcaseDrawerSurface>
                        </ComparisonColumn>
                    }
                />

                {/* Row 3 — the schema-aware form direction. Was the last
                    proposal sitting on this page before we started this
                    iteration. Kept here so the team can compare the
                    detection-driven cards approach against an explicit
                    per-testset schema form. */}
                <ExperimentRow
                    title="Proposal · Schema-aware form (alternative direction)"
                    lead={
                        "A different direction. If a testset has a saved schema, the " +
                        "drawer renders a labelled form per known column instead of " +
                        "inferring field types from data. Required fields are flagged. " +
                        "Saving sends a per-field PATCH instead of replaying the whole " +
                        "row. The user gets a predictable, repeatable form per testset; " +
                        "the trade-off is that the schema becomes another thing to " +
                        "author and maintain. Same testcase data as the rows above, " +
                        "different render paradigm."
                    }
                    statusQuo={statusQuoColumn("row-3")}
                    proposal={
                        <ComparisonColumn
                            label="Proposal"
                            tone="proposed"
                            sub="Schema-derived form"
                        >
                            <ProdTestcaseDrawerSurface>
                                <div style={styles.schemaFormBody}>
                                    <SchemaForm schema={schema} data={tc.data} />
                                </div>
                            </ProdTestcaseDrawerSurface>
                        </ComparisonColumn>
                    }
                />

                <div style={styles.crossLinks}>
                    <strong>Other surfaces:</strong>{" "}
                    <Link href="/solutions-playground" style={styles.link}>
                        Solutions · Playground →
                    </Link>{" "}
                    ·{" "}
                    <Link href="/solutions-tables" style={styles.link}>
                        Solutions · Tables →
                    </Link>
                </div>
            </MockupPageShell>
        </>
    )
}

interface ExperimentRowProps {
    title: string
    lead: string
    statusQuo: ReactNode
    proposal: ReactNode
}

function ExperimentRow({title, lead, statusQuo, proposal}: ExperimentRowProps) {
    return (
        <section style={styles.experiment}>
            <header style={styles.experimentHeader}>
                <h2 style={styles.experimentTitle}>{title}</h2>
            </header>
            <p style={styles.experimentLead}>{lead}</p>
            <div style={styles.compareRow}>
                {statusQuo}
                {proposal}
            </div>
        </section>
    )
}

interface ComparisonColumnProps {
    label: string
    sub?: string
    tone: "today" | "proposed"
    children: ReactNode
}

function ComparisonColumn({label, sub, tone, children}: ComparisonColumnProps) {
    return (
        <div style={styles.column}>
            <header style={styles.columnHeader}>
                <span
                    style={{
                        ...styles.columnTag,
                        ...(tone === "today" ? styles.columnTagToday : styles.columnTagProposed),
                    }}
                >
                    {label}
                </span>
                {sub ? <span style={styles.columnSub}>{sub}</span> : null}
            </header>
            {children}
        </div>
    )
}

const styles = {
    toolbar: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap" as const,
        gap: 12,
        padding: "10px 14px",
        marginBottom: 16,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        position: "sticky" as const,
        top: 0,
        zIndex: 5,
    },
    label: {
        fontSize: 12,
        fontWeight: 600,
        color: "#051729",
    },
    divider: {
        width: 1,
        height: 20,
        background: "rgba(5, 23, 41, 0.12)",
    },
    link: {color: "#1677ff", fontWeight: 500},
    experiment: {
        marginBottom: 32,
    },
    experimentHeader: {
        marginBottom: 4,
    },
    experimentTitle: {
        fontSize: 16,
        fontWeight: 700,
        color: "#051729",
        margin: 0,
    },
    experimentLead: {
        marginTop: 0,
        marginBottom: 16,
        padding: "12px 16px",
        background: "#fffbe6",
        borderLeft: "3px solid #faad14",
        fontSize: 13,
        color: "#051729",
        lineHeight: 1.6,
        borderRadius: "0 6px 6px 0",
    },
    compareRow: {
        display: "flex",
        flexDirection: "row" as const,
        alignItems: "stretch",
        gap: 16,
        // Allow horizontal scroll inside this row when the two production-
        // sized drawers don't fit; the parent page handles vertical flow.
        overflowX: "auto" as const,
        paddingBottom: 4,
    },
    column: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 8,
        flexShrink: 0,
    },
    columnHeader: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        paddingLeft: 4,
    },
    columnTag: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    columnTagToday: {
        background: "rgba(5, 23, 41, 0.06)",
        color: "rgba(5, 23, 41, 0.65)",
    },
    columnTagProposed: {
        background: "#f0f9ff",
        color: "#1677ff",
    },
    columnSub: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.55)",
    },
    schemaFormBody: {
        padding: 16,
        background: "#fafafa",
        minHeight: 480,
    },
    crossLinks: {
        marginTop: 24,
        padding: "10px 14px",
        background: "#fafafa",
        border: "1px solid rgba(5, 23, 41, 0.06)",
        borderRadius: 8,
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.8,
    },
}
