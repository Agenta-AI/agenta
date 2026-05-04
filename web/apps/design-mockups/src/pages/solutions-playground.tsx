/**
 * Solutions · Playground — unified demo combining every playground-related proposal.
 *
 * Three-column compare grid: Today (production-faithful), Proposed embedded
 * (ProposedDrillIn as inputs body — every gap-01..06 decision propagates
 * here), Alt compact (one row per field, click-to-edit). Three fixture rows
 * exercise different gap concerns: chip-showcase (gap-01), messages
 * (gap-06), markdown article (gap-01 long-form mode).
 *
 * gap-08 (variable validation) lives on its own page since it's about the
 * *prompt* surface adjacent to the execution item, not the execution item
 * itself. Cross-link below.
 */

import {useState} from "react"

import Head from "next/head"
import Link from "next/link"

import {Segmented} from "antd"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"
import {PlaygroundExecutionItem} from "@/mockups/components/proposed/PlaygroundExecutionItem"
import {PlaygroundExecutionItemCompact} from "@/mockups/components/proposed/PlaygroundExecutionItemCompact"
import {PlaygroundExecutionItemToday} from "@/mockups/components/proposed/PlaygroundExecutionItemToday"
import {
    InvalidVariable,
    PromptVariableValidation,
    ValidVariable,
} from "@/mockups/components/proposed/PromptVariableValidation"
import {type ChipRenderMode} from "@/mockups/components/proposed/ProposedDrillIn"
import {
    fixture07_messages_and_tools,
    fixture_chip_showcase,
    fixture_kitchen_sink,
    fixture_markdown_article,
} from "@/mockups/data/stubTestcases"

const kitchenSinkTestcase = fixture_kitchen_sink[0]
const kiribatiTestcase = fixture_chip_showcase[0]
const messagesTrace = fixture07_messages_and_tools.find(
    (tc) => tc.id === "tc-07-kiribati-tool",
)!
const markdownArticle = fixture_markdown_article[0]

// Toggle to bring back the focused-fixture rows (chip-showcase, messages
// trace, markdown article). Kept as a flag (rather than deleting them) so
// they're one edit away if a focused review is needed. Kitchen-sink Vanuatu
// (Row 1) covers every gap on its own.
const SHOW_EXTRA_ROWS = false

export default function SolutionsPlayground() {
    const [editMode, setEditMode] = useState<"editable" | "read-only">("editable")
    const [chipMode, setChipMode] = useState<ChipRenderMode>("all")
    const editable = editMode === "editable"

    return (
        <>
            <Head>
                <title>Solutions · Playground — unified execution-item demo</title>
            </Head>
            <MockupPageShell
                title="Solutions · Playground (execution item)"
                blurb={
                    "Three-way comparison: production playground (Today), Proposed (ProposedDrillIn as inputs body), and Alt (compact one-row-per-field). All three respect the chip-mode toggle. Three fixture rows demonstrate the long-form / markdown editor mode (gap-01) and the chat-message rendering (gap-06)."
                }
                notes={
                    <>
                        <strong>What's on each panel:</strong>
                        <ul style={styles.notesList}>
                            <li>
                                <strong>Today</strong>: production playground —
                                borderless textarea per input, no chips, no
                                output rendering until Run. Long-form / markdown
                                inputs use the production Lexical editor with the
                                visible <code>MarkdownToggleButton</code>.
                            </li>
                            <li>
                                <strong>Proposed (embedded)</strong>: inputs
                                body is <code>ProposedDrillIn</code>, so every
                                gap-01..06 decision propagates from the drawer
                                surface. Type chips, type-switching popover,
                                long-form editor mode toggle, chat cards for
                                messages — all the same code path. Output area
                                also has a clickable chip for read-only mode
                                switching.
                            </li>
                            <li>
                                <strong>Alt (compact)</strong>: one ~26px row
                                per input. Click primitives → row morphs to
                                inline editor. Click structured rows → expand
                                inline. Long-form fields hydrate to{" "}
                                <code>[long-str]</code> mode automatically.
                            </li>
                        </ul>
                        <br />
                        <strong>Honest trade-offs across the three columns:</strong>
                        <ul style={styles.notesList}>
                            <li>
                                <strong>Today</strong>: simplest, most familiar.
                                Loses on type-aware editing.
                            </li>
                            <li>
                                <strong>Proposed (embedded)</strong>: best
                                ergonomics for power users — every primitive's
                                editor is always-mounted. Loses on density: 6+
                                inputs scroll.
                            </li>
                            <li>
                                <strong>Alt (compact)</strong>: best density —
                                typed table aesthetic, full input shape visible
                                at a glance. Loses on click-to-edit friction.
                                Deep nesting breaks the density argument when
                                inline expansion mounts an embedded drill-in
                                mid-list.
                            </li>
                        </ul>
                        <br />
                        <strong>Open question:</strong> playground rows are
                        read more than edited — chip density matters more here
                        than in the drawer. Argues for{" "}
                        <code>ambiguous-only</code> as the default chip mode in
                        the playground, even if <code>all</code> stays the
                        default in the drawer. A user-level "compact mode"
                        toggle is the obvious shipping shape if Compact proves
                        valuable.
                    </>
                }
                competitiveNotes={
                    <>
                        Braintrust's playground keeps everything inline; Langfuse
                        separates Tools / Schema / Variables into top dropdowns.
                        Neither surfaces type chips on input rows. Our chips
                        compose with both layouts. See{" "}
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
                <div style={styles.toolbar}>
                    <span style={styles.label}>Edit mode:</span>
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

                <section style={styles.promptSection}>
                    <header style={styles.promptHeader}>
                        <span style={styles.promptTag}>gap-08</span>
                        <h2 style={styles.promptTitle}>
                            Prompt surface — variable validation
                        </h2>
                    </header>
                    <p style={styles.promptLead}>
                        This is the prompt-side of the playground (where
                        variables are typed). The execution items below are
                        where they get resolved. Today's playground catches
                        bad variable references at run time only; Proposed
                        catches them at edit time via the attached testset's
                        schema.
                    </p>
                    <div style={styles.promptGrid}>
                        <div>
                            <div style={styles.promptColLabel}>Today</div>
                            <PromptVariableValidation
                                datasetName="04 Stringfied Nested"
                                messages={[
                                    {
                                        role: "user",
                                        body: (
                                            <>
                                                hello{" "}
                                                <ValidVariable>
                                                    {"{{metadata.source}}"}
                                                </ValidVariable>
                                            </>
                                        ),
                                    },
                                ]}
                            />
                        </div>
                        <div>
                            <div style={styles.promptColLabel}>
                                Proposed (banner + tooltip)
                            </div>
                            <PromptVariableValidation
                                datasetName="04 Stringfied Nested"
                                banner={
                                    <>
                                        Try inserting dataset variables from{" "}
                                        <code>{"{{(input)}}"}</code>,{" "}
                                        <code>{"{{(expected)}}"}</code>, or{" "}
                                        <code>{"{{(metadata)}}"}</code>.
                                    </>
                                }
                                messages={[
                                    {
                                        role: "user",
                                        body: (
                                            <>
                                                hello{" "}
                                                <InvalidVariable variable="metadata.source">
                                                    {"{{metadata.source}}"}
                                                </InvalidVariable>
                                            </>
                                        ),
                                    },
                                ]}
                            />
                        </div>
                    </div>
                </section>

                <h2 style={styles.executionItemsTitle}>
                    Execution items — three-way compare
                </h2>

                <div style={styles.compareGrid3}>
                    <div style={styles.colHeader}>
                        <span style={styles.tagToday}>Today</span>
                        <span style={styles.colSub}>
                            Production · borderless textarea per input
                        </span>
                    </div>
                    <div style={styles.colHeader}>
                        <span style={styles.tagProposed}>Proposed · embedded</span>
                        <span style={styles.colSub}>
                            ProposedDrillIn as inputs body
                        </span>
                    </div>
                    <div style={styles.colHeader}>
                        <span style={styles.tagAlt}>Alt · compact</span>
                        <span style={styles.colSub}>
                            One row per field · click to edit
                        </span>
                    </div>

                    {/* Row 1 — Kitchen sink Vanuatu (every gap on one row) */}
                    <PlaygroundExecutionItemToday
                        testcaseLabel="testcase 1 — kitchen sink"
                        inputs={[
                            {name: "country", value: kitchenSinkTestcase.data.country as string},
                            {
                                name: "population_thousands",
                                value: String(kitchenSinkTestcase.data.population_thousands),
                            },
                            {
                                name: "is_island_nation",
                                value: String(kitchenSinkTestcase.data.is_island_nation),
                            },
                            {name: "languages"},
                            {name: "inputs"},
                            {name: "geo"},
                            {name: "metadata", value: kitchenSinkTestcase.data.metadata as string},
                            {name: "messages"},
                        ]}
                    />
                    <PlaygroundExecutionItem
                        testcaseLabel={`Testcase · ${kitchenSinkTestcase.label}`}
                        inputs={[
                            {name: "country", value: kitchenSinkTestcase.data.country},
                            {
                                name: "population_thousands",
                                value: kitchenSinkTestcase.data.population_thousands,
                            },
                            {
                                name: "is_island_nation",
                                value: kitchenSinkTestcase.data.is_island_nation,
                            },
                            {name: "notes", value: kitchenSinkTestcase.data.notes},
                            {name: "languages", value: kitchenSinkTestcase.data.languages},
                            {name: "correct_answer", value: kitchenSinkTestcase.data.correct_answer},
                            {name: "inputs", value: kitchenSinkTestcase.data.inputs},
                            {name: "outputs", value: kitchenSinkTestcase.data.outputs},
                            {name: "metadata", value: kitchenSinkTestcase.data.metadata},
                            {name: "geo.region", value: kitchenSinkTestcase.data["geo.region"]},
                            {name: "geo", value: kitchenSinkTestcase.data.geo},
                            {name: "messages", value: kitchenSinkTestcase.data.messages},
                        ]}
                        output={{
                            role: "assistant",
                            content:
                                "The capital of Vanuatu is Port Vila (ISO code: VU), on the southern coast of Efate Island.",
                        }}
                        evaluators={[
                            {name: "exact_match", score: 1.0, passed: true},
                            {name: "factual", score: 0.95, passed: true},
                            {name: "tool_calls_correct", score: 1.0, passed: true},
                        ]}
                        durationMs={2410}
                        chipMode={chipMode}
                        editable={editable}
                    />
                    <PlaygroundExecutionItemCompact
                        testcaseLabel={`Testcase · ${kitchenSinkTestcase.label}`}
                        inputs={[
                            {name: "country", value: kitchenSinkTestcase.data.country},
                            {
                                name: "population_thousands",
                                value: kitchenSinkTestcase.data.population_thousands,
                            },
                            {
                                name: "is_island_nation",
                                value: kitchenSinkTestcase.data.is_island_nation,
                            },
                            {name: "notes", value: kitchenSinkTestcase.data.notes},
                            {name: "languages", value: kitchenSinkTestcase.data.languages},
                            {name: "correct_answer", value: kitchenSinkTestcase.data.correct_answer},
                            {name: "inputs", value: kitchenSinkTestcase.data.inputs},
                            {name: "outputs", value: kitchenSinkTestcase.data.outputs},
                            {name: "metadata", value: kitchenSinkTestcase.data.metadata},
                            {name: "geo.region", value: kitchenSinkTestcase.data["geo.region"]},
                            {name: "geo", value: kitchenSinkTestcase.data.geo},
                            {name: "messages", value: kitchenSinkTestcase.data.messages},
                        ]}
                        output={{
                            role: "assistant",
                            content:
                                "The capital of Vanuatu is Port Vila (ISO code: VU), on the southern coast of Efate Island.",
                        }}
                        evaluators={[
                            {name: "exact_match", score: 1.0, passed: true},
                            {name: "factual", score: 0.95, passed: true},
                            {name: "tool_calls_correct", score: 1.0, passed: true},
                        ]}
                        durationMs={2410}
                        chipMode={chipMode}
                        editable={editable}
                    />

                    {SHOW_EXTRA_ROWS ? (
                        <>
                    {/* Row 2 — Kiribati chip-showcase (focused gap-01) */}
                    <PlaygroundExecutionItemToday
                        testcaseLabel="testcase 2 — chip-showcase"
                        inputs={[
                            {name: "country", value: kiribatiTestcase.data.country as string},
                            {name: "age", value: String(kiribatiTestcase.data.age)},
                            {name: "verified", value: String(kiribatiTestcase.data.verified)},
                        ]}
                    />
                    <PlaygroundExecutionItem
                        testcaseLabel={`Testcase · ${kiribatiTestcase.label}`}
                        inputs={[
                            {name: "country", value: kiribatiTestcase.data.country},
                            {name: "age", value: kiribatiTestcase.data.age},
                            {name: "verified", value: kiribatiTestcase.data.verified},
                            {name: "languages", value: kiribatiTestcase.data.languages},
                            {name: "geo", value: kiribatiTestcase.data.geo},
                            {name: "metadata", value: kiribatiTestcase.data.metadata},
                        ]}
                        output="Kiribati's capital is South Tarawa, a small atoll in the central Pacific."
                        evaluators={[
                            {name: "exact_match", score: 1.0, passed: true},
                            {name: "factual", score: 0.92, passed: true},
                        ]}
                        chipMode={chipMode}
                        editable={editable}
                    />
                    <PlaygroundExecutionItemCompact
                        testcaseLabel={`Testcase · ${kiribatiTestcase.label}`}
                        inputs={[
                            {name: "country", value: kiribatiTestcase.data.country},
                            {name: "age", value: kiribatiTestcase.data.age},
                            {name: "verified", value: kiribatiTestcase.data.verified},
                            {name: "languages", value: kiribatiTestcase.data.languages},
                            {name: "geo", value: kiribatiTestcase.data.geo},
                            {name: "metadata", value: kiribatiTestcase.data.metadata},
                        ]}
                        output="Kiribati's capital is South Tarawa, a small atoll in the central Pacific."
                        evaluators={[
                            {name: "exact_match", score: 1.0, passed: true},
                            {name: "factual", score: 0.92, passed: true},
                        ]}
                        chipMode={chipMode}
                        editable={editable}
                    />

                    {/* Row 3 — Messages trace (gap-06) */}
                    <PlaygroundExecutionItemToday
                        testcaseLabel="testcase 2"
                        inputs={[
                            {name: "messages"},
                            {
                                name: "country",
                                value: (messagesTrace.data as Record<string, unknown>)
                                    .country as string,
                            },
                        ]}
                    />
                    <PlaygroundExecutionItem
                        testcaseLabel={`Trace · ${messagesTrace.label}`}
                        inputs={[
                            {
                                name: "messages",
                                value: (messagesTrace.data as Record<string, unknown>)
                                    .messages,
                            },
                            {
                                name: "country",
                                value: (messagesTrace.data as Record<string, unknown>)
                                    .country,
                            },
                        ]}
                        output={{
                            role: "assistant",
                            content:
                                "The capital of Kiribati is South Tarawa, on the atoll of Tarawa in the central Pacific.",
                        }}
                        evaluators={[
                            {name: "tool_calls_correct", score: 1.0, passed: true},
                        ]}
                        durationMs={2310}
                        chipMode={chipMode}
                        editable={editable}
                    />
                    <PlaygroundExecutionItemCompact
                        testcaseLabel={`Trace · ${messagesTrace.label}`}
                        inputs={[
                            {
                                name: "messages",
                                value: (messagesTrace.data as Record<string, unknown>)
                                    .messages,
                            },
                            {
                                name: "country",
                                value: (messagesTrace.data as Record<string, unknown>)
                                    .country,
                            },
                        ]}
                        output={{
                            role: "assistant",
                            content:
                                "The capital of Kiribati is South Tarawa, on the atoll of Tarawa in the central Pacific.",
                        }}
                        evaluators={[
                            {name: "tool_calls_correct", score: 1.0, passed: true},
                        ]}
                        durationMs={2310}
                        chipMode={chipMode}
                        editable={editable}
                    />

                    {/* Row 3 — Markdown article (gap-01 long-form mode) */}
                    <PlaygroundExecutionItemToday
                        testcaseLabel="testcase 3"
                        inputs={[
                            {name: "title", value: markdownArticle.data.title as string},
                            {name: "prompt", value: markdownArticle.data.prompt as string},
                            {
                                name: "system_persona",
                                value: markdownArticle.data.system_persona as string,
                            },
                        ]}
                    />
                    <PlaygroundExecutionItem
                        testcaseLabel={`Testcase · ${markdownArticle.label}`}
                        inputs={[
                            {name: "title", value: markdownArticle.data.title},
                            {name: "prompt", value: markdownArticle.data.prompt},
                            {
                                name: "system_persona",
                                value: markdownArticle.data.system_persona,
                            },
                            {name: "temperature", value: markdownArticle.data.temperature},
                        ]}
                        output={`# Capital of Kiribati\n\nThe capital is **South Tarawa**, an atoll in the central Pacific.`}
                        evaluators={[
                            {name: "factual", score: 1.0, passed: true},
                            {name: "format_md", score: 0.95, passed: true},
                        ]}
                        durationMs={1820}
                        chipMode={chipMode}
                        editable={editable}
                    />
                    <PlaygroundExecutionItemCompact
                        testcaseLabel={`Testcase · ${markdownArticle.label}`}
                        inputs={[
                            {name: "title", value: markdownArticle.data.title},
                            {name: "prompt", value: markdownArticle.data.prompt},
                            {
                                name: "system_persona",
                                value: markdownArticle.data.system_persona,
                            },
                            {name: "temperature", value: markdownArticle.data.temperature},
                        ]}
                        output={`# Capital of Kiribati\n\nThe capital is **South Tarawa**, an atoll in the central Pacific.`}
                        evaluators={[
                            {name: "factual", score: 1.0, passed: true},
                            {name: "format_md", score: 0.95, passed: true},
                        ]}
                        durationMs={1820}
                        chipMode={chipMode}
                        editable={editable}
                    />
                        </>
                    ) : null}
                </div>

                <div style={styles.crossLinks}>
                    <strong>Other surfaces:</strong>{" "}
                    <Link href="/solutions-drill-in" style={styles.link}>
                        Solutions · Drill-in →
                    </Link>{" "}
                    ·{" "}
                    <Link href="/solutions-tables" style={styles.link}>
                        Solutions · Tables →
                    </Link>
                    <br />
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-01-type-chips" style={styles.link}>
                        gap-01
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-06-messages-renderer" style={styles.link}>
                        gap-06
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-08-playground-variable-validation" style={styles.link}>
                        gap-08 (variable validation, prompt surface)
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
    label: {fontSize: 12, fontWeight: 600, color: "#051729"},
    divider: {width: 1, height: 20, background: "rgba(5, 23, 41, 0.12)"},
    link: {color: "#1677ff", fontWeight: 500},
    notesList: {margin: "8px 0", paddingLeft: 20, lineHeight: 1.7},
    compareGrid3: {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 12,
        marginTop: 12,
        rowGap: 24,
    },
    colHeader: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        paddingBottom: 4,
        borderBottom: "1px solid rgba(5, 23, 41, 0.08)",
    },
    tagToday: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        background: "rgba(5, 23, 41, 0.06)",
        color: "rgba(5, 23, 41, 0.65)",
    },
    tagProposed: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        background: "#f0f9ff",
        color: "#1677ff",
    },
    tagAlt: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        background: "#f9f0ff",
        color: "#722ed1",
    },
    colSub: {fontSize: 11, color: "rgba(5, 23, 41, 0.55)"},
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
    promptSection: {
        padding: 16,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        marginBottom: 24,
    },
    promptHeader: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 6,
    },
    promptTag: {
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
    promptTitle: {
        fontSize: 14,
        fontWeight: 700,
        margin: 0,
        color: "#051729",
    },
    promptLead: {
        fontSize: 12,
        color: "rgba(5, 23, 41, 0.65)",
        lineHeight: 1.6,
        margin: "0 0 12px",
    },
    promptGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 16,
    },
    promptColLabel: {
        fontSize: 11,
        fontWeight: 600,
        color: "rgba(5, 23, 41, 0.55)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        marginBottom: 6,
    },
    executionItemsTitle: {
        fontSize: 14,
        fontWeight: 700,
        margin: "0 0 4px",
        color: "#051729",
    },
}
