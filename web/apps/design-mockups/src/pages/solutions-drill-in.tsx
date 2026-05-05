/**
 * Solutions · Drill-in — unified demo combining every drawer-related proposal.
 *
 * Each gap page (gap-01..06) discusses ONE problem + proposed solution. This
 * page mounts the proposed solutions together on the testcase drawer surface
 * so the team can see the integrated experience instead of one feature at a
 * time. Pick a fixture from the toolbar to exercise different proposals:
 *
 *   - chip-showcase  → gap-01 (chips on every row)
 *   - 06 deeply nested → gap-03 (auto-expand)
 *   - 08 collision   → gap-05 (dot-key + collision chips)
 *   - 07 messages    → gap-06 (chat cards + tool-call cards inline)
 *   - markdown art   → gap-01 long-form mode + markdown editor
 *
 * Today (production DrillInContent) on the left, Proposed (ProposedDrillIn
 * with all features enabled) on the right. Toggles for chip-mode, drawer
 * mode (editable/read-only), and auto-expand drive the proposed panel.
 */

import {useState} from "react"

import Head from "next/head"
import Link from "next/link"

import {Segmented} from "antd"

import {DrawerSurface} from "@/mockups/components/DrawerSurface"
import {MockupPageShell} from "@/mockups/components/MockupPageShell"
import {SideBySide} from "@/mockups/components/SideBySide"
import {StubDrillIn} from "@/mockups/components/StubDrillIn"
import {
    ProposedDrillIn,
    type ChipRenderMode,
} from "@/mockups/components/proposed/ProposedDrillIn"
import {
    FIXTURE02_INFERRED_SCHEMA,
    SchemaForm,
    countSchemaFields,
} from "@/mockups/components/proposed/SchemaForm"
import {
    fixture02_capitals_with_geo,
    fixture06_deeply_nested,
    fixture07_messages_and_tools,
    fixture08_dot_key_collision,
    fixture_chip_showcase,
    fixture_kitchen_sink,
    fixture_kitchen_sink_known_columns,
    fixture_markdown_article,
} from "@/mockups/data/stubTestcases"

// Toggle to bring back the multi-fixture switcher. Kept as a flag (rather
// than deleting the FIXTURES array) so individual gap fixtures stay one
// edit away if a focused review is needed.
const SHOW_FIXTURE_SWITCHER = false

// gap-04 — union of all column keys across fixture08 rows. Kiribati only
// authors a subset of these, so the ghost-row machinery on ProposedDrillIn
// has something to render.
const FIXTURE08_KNOWN_COLUMNS = [
    "country",
    "geo.region",
    "geo.subregion",
    "geo",
    "correct_answer",
    "outputs",
    "user.profile.email",
    "user.profile.role",
]

const FIXTURES = [
    {
        id: "kitchen-sink",
        label: "Kitchen sink — every gap on one row",
        testcase: fixture_kitchen_sink[0],
        autoExpand: true,
        detectCollisions: true,
        knownColumns: fixture_kitchen_sink_known_columns,
        gapNote:
            "All gaps on one row. Vanuatu has every chip variant (gap-01), nested inputs/outputs auto-expand (gap-03), `metadata` is stringified-JSON with parse-on-detect (gap-04), `geo.region` collides between literal and nested shapes (gap-05), `messages` includes a tool_call + role:\"tool\" response (gap-06), and `correct_answer` is markdown-heavy → hydrates as [long-str] (gap-01 long-form). The other rows in this testset (Tuvalu, Kiribati) miss columns Vanuatu authors → ghost rows render as [not authored] (gap-04).",
    },
    {
        id: "chip-showcase",
        label: "Chip showcase (gap-01)",
        testcase: fixture_chip_showcase[0],
        autoExpand: true,
        detectCollisions: false,
        gapNote:
            "gap-01 — every primitive type variant on one row, exercising the full chip vocabulary.",
    },
    {
        id: "06-deep",
        label: "06 deeply nested (gap-03)",
        testcase: fixture06_deeply_nested.find((tc) => tc.id === "tc-06-tuvalu")!,
        autoExpand: true,
        detectCollisions: false,
        gapNote:
            "gap-03 — auto-expand top-level keys avoids the bailout-to-code-editor problem at depth 5.",
    },
    {
        id: "08-collision",
        label: "08 dot-key collision (gap-05 + gap-04)",
        testcase: fixture08_dot_key_collision.find((tc) => tc.id === "tc-08-kiribati")!,
        autoExpand: true,
        detectCollisions: true,
        knownColumns: FIXTURE08_KNOWN_COLUMNS,
        gapNote:
            "gap-05 — literal `\"geo.region\"` and nested `geo.region` both visible with [dotted-key] + [⚠ collision] chips. gap-04 — keys authored by *other* rows (e.g. user.profile.*) render as ghost rows with [not authored] chip; they're in the testset's union but not stored on this row.",
    },
    {
        id: "07-messages",
        label: "07 messages + tools (gap-06)",
        testcase: fixture07_messages_and_tools.find(
            (tc) => tc.id === "tc-07-kiribati-tool",
        )!,
        autoExpand: true,
        detectCollisions: false,
        gapNote:
            "gap-06 — ChatMessageEditor renders inline at root + tool-call card with parsed arguments.",
    },
    {
        id: "markdown",
        label: "Markdown article (long-form)",
        testcase: fixture_markdown_article[0],
        autoExpand: false,
        detectCollisions: false,
        gapNote:
            "Long-form / markdown content. The chip hydrates as `[long-str]` so the field opens in the Lexical editor with markdown preview by default.",
    },
    {
        id: "02-nested",
        label: "02 nested (baseline)",
        testcase: fixture02_capitals_with_geo.find((tc) => tc.id === "tc-02-tuvalu")!,
        autoExpand: true,
        detectCollisions: false,
        gapNote:
            "Moderate nesting. Useful baseline — shows how the chip + auto-expand combo reads on a normal testcase.",
    },
] as const

export default function SolutionsDrillIn() {
    const [fixtureId, setFixtureId] =
        useState<(typeof FIXTURES)[number]["id"]>("kitchen-sink")
    const [editMode, setEditMode] = useState<"editable" | "read-only">("editable")
    const [chipMode, setChipMode] = useState<ChipRenderMode>("all")
    const editable = editMode === "editable"

    const active = FIXTURES.find((f) => f.id === fixtureId) ?? FIXTURES[0]
    const tc = active.testcase

    return (
        <>
            <Head>
                <title>Solutions · Drill-in — unified drawer demo</title>
            </Head>
            <MockupPageShell
                title="Solutions · Drill-in (testcase drawer)"
                blurb={
                    "Production DrillInContent (Today, left) next to ProposedDrillIn (Proposed, right) with every drawer-related proposal applied: gap-01 chips, gap-03 auto-expand, gap-05 dot-key collision detection, gap-06 chat-message rendering, gap-01 long-form / markdown editor toggle, type-switching via chips. Pick a fixture below to exercise different combinations."
                }
                notes={
                    <>
                        <strong>What's proposed on the right panel:</strong>
                        <ul style={styles.notesList}>
                            <li>
                                <strong>gap-01</strong>: TypeChip on every field row.
                                Click any chip → conversion popover (Convert type +
                                Editor mode). See{" "}
                                <Link href="/gap-01-type-chips" style={styles.link}>
                                    gap-01 (concept)
                                </Link>{" "}
                                for the chip vocabulary.
                            </li>
                            <li>
                                <strong>gap-03</strong>: top-level keys auto-expand
                                inline as nested cards. No more wall of JSON at
                                root.
                            </li>
                            <li>
                                <strong>gap-05</strong>: literal-dot keys get{" "}
                                <code>[dotted-key]</code> chip; collisions stack{" "}
                                <code>[⚠ collision]</code>.
                            </li>
                            <li>
                                <strong>gap-06</strong>: messages-shaped arrays
                                render as chat cards inline; tool-call cards parse
                                the <code>arguments</code> JSON automatically.
                            </li>
                            <li>
                                <strong>gap-01 long-form</strong>: long strings
                                hydrate in <code>[long-str]</code> mode (Lexical
                                editor with markdown preview toggle). User can
                                switch back to <code>[str]</code> via the chip
                                popover.
                            </li>
                        </ul>
                    </>
                }
            >
                <div style={styles.toolbar}>
                    {/* Fixture switcher hidden — kitchen-sink covers every gap on
                        one row. Re-enable by setting SHOW_FIXTURE_SWITCHER=true. */}
                    {SHOW_FIXTURE_SWITCHER ? (
                        <>
                            <span style={styles.label}>Fixture:</span>
                            <Segmented
                                size="small"
                                value={fixtureId}
                                options={FIXTURES.map((f) => ({
                                    label: f.label,
                                    value: f.id,
                                }))}
                                onChange={(v) =>
                                    setFixtureId(
                                        v as (typeof FIXTURES)[number]["id"],
                                    )
                                }
                            />
                            <span style={styles.divider} />
                        </>
                    ) : null}
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
                    <span style={styles.label}>Chip mode:</span>
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
                <div style={styles.fixtureNote}>{active.gapNote}</div>

                <SideBySide
                    todaySub="Production DrillInContent — no chip, no auto-expand"
                    today={
                        <DrawerSurface title={`Testcase · ${tc.label}`}>
                            <StubDrillIn
                                key={`${active.id}-today`}
                                initialData={tc.data}
                                rootTitle={tc.label}
                                editable={editable}
                                showFieldDrillIn
                                showFieldCollapse
                            />
                        </DrawerSurface>
                    }
                    proposedSub="ProposedDrillIn — all gap-01..06 proposals applied"
                    proposed={
                        <DrawerSurface title={`Testcase · ${tc.label}`}>
                            <ProposedDrillIn
                                key={`${active.id}-proposed`}
                                data={tc.data}
                                rootTitle={tc.label}
                                autoExpand={active.autoExpand}
                                detectDotKeyCollisions={active.detectCollisions}
                                editable={editable}
                                chipMode={chipMode}
                                knownColumns={
                                    "knownColumns" in active
                                        ? (active.knownColumns as string[])
                                        : undefined
                                }
                            />
                        </DrawerSurface>
                    }
                />

                {/* gap-07 — schema-aware form alternative on the 02 baseline
                    fixture. When a per-testset schema exists, the drawer can
                    render a labelled form instead of detection-driven cards.
                    Same testcase, different paradigm — the team can see both
                    side-by-side. */}
                {active.id === "02-nested" ? (
                    <section style={styles.schemaSection}>
                        <header style={styles.schemaHeader}>
                            <span style={styles.schemaTag}>gap-07</span>
                            <h2 style={styles.schemaTitle}>
                                Alternative — schema-aware form
                            </h2>
                            <span style={styles.schemaCount}>
                                schema · {countSchemaFields(FIXTURE02_INFERRED_SCHEMA)}{" "}
                                fields
                            </span>
                        </header>
                        <p style={styles.schemaLead}>
                            When a per-testset schema exists, the drawer renders a
                            labelled form with type-aware inputs per known column.
                            Required fields flagged. Per-field PATCH on save (no
                            JSON-blob replay). Subsumes gap-03 auto-expand and
                            sidesteps gap-04 union projection.
                        </p>
                        <div style={styles.schemaFrame}>
                            <SchemaForm
                                schema={FIXTURE02_INFERRED_SCHEMA}
                                data={tc.data}
                            />
                        </div>
                    </section>
                ) : null}

                <div style={styles.crossLinks}>
                    <strong>Other surfaces:</strong>{" "}
                    <Link href="/solutions-playground" style={styles.link}>
                        Solutions · Playground →
                    </Link>{" "}
                    ·{" "}
                    <Link href="/solutions-tables" style={styles.link}>
                        Solutions · Tables →
                    </Link>{" "}
                    <br />
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-01-type-chips" style={styles.link}>
                        gap-01
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-03-drill-in-root-view" style={styles.link}>
                        gap-03
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-05-dot-key-disambiguation" style={styles.link}>
                        gap-05
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-06-messages-renderer" style={styles.link}>
                        gap-06
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-07-schema-aware-form" style={styles.link}>
                        gap-07 (schema-aware form)
                    </Link>
                </div>
            </MockupPageShell>
        </>
    )
}

const styles = {
    toolbar: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap" as const,
        gap: 12,
        padding: "10px 14px",
        marginBottom: 12,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
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
    fixtureNote: {
        marginBottom: 12,
        padding: "10px 14px",
        background: "#fffbe6",
        borderLeft: "3px solid #faad14",
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.6,
        borderRadius: "0 4px 4px 0",
    },
    notesList: {
        margin: "8px 0",
        paddingLeft: 20,
        lineHeight: 1.7,
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
    schemaSection: {
        marginTop: 24,
        padding: 16,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
    },
    schemaHeader: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 8,
    },
    schemaTag: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        background: "#fff1b8",
        color: "#874d00",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    schemaTitle: {
        fontSize: 14,
        fontWeight: 700,
        margin: 0,
        color: "#051729",
    },
    schemaCount: {
        marginLeft: "auto" as const,
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.55)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    schemaLead: {
        fontSize: 12,
        color: "rgba(5, 23, 41, 0.65)",
        lineHeight: 1.6,
        margin: "0 0 12px",
    },
    schemaFrame: {
        background: "#fafafa",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        padding: 16,
    },
}
