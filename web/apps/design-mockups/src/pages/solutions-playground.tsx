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
    PlaygroundVariableMap,
    type PlaygroundVariable,
} from "@/mockups/components/proposed/PlaygroundVariableMap"
import {
    PromptConfigView,
    type PromptConfig,
} from "@/mockups/components/proposed/PromptConfigView"
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

// gap-09 — variable provenance + usage map for the Vanuatu kitchen-sink
// playground row. Demonstrates the four states described in
// /gap-09-variable-provenance:
//   used   — referenced by every prompt + on the testcase
//   chain  — used by some prompts in the chain but not all
//   draft  — referenced in a prompt but NOT on the testcase yet
//   unused — on the testcase but not referenced by any prompt (collapsed
//            by default behind a "Show unused" toggle)
const KITCHEN_SINK_VARIABLE_MAP: PlaygroundVariable[] = [
    // Used by every prompt — default rendering
    {
        name: "country",
        value: kitchenSinkTestcase.data.country,
        state: "used",
    },
    {
        name: "messages",
        value: kitchenSinkTestcase.data.messages,
        state: "used",
    },
    // Chain-scoped — different prompts use different variables in a 4-step chain
    {
        name: "geo",
        value: kitchenSinkTestcase.data.geo,
        state: "chain",
        usedByPrompts: [2, 3],
    },
    {
        name: "languages",
        value: kitchenSinkTestcase.data.languages,
        state: "chain",
        usedByPrompts: [1],
    },
    // Draft — referenced in a prompt template but doesn't exist on the
    // testcase yet. The user typed `{{iso_code}}` somewhere; it'll be
    // synced to the testset when they save.
    {
        name: "iso_code",
        value: undefined,
        state: "draft",
    },
    // Unused — on the testcase but no prompt in the chain references them
    {
        name: "population_thousands",
        value: kitchenSinkTestcase.data.population_thousands,
        state: "unused",
    },
    {
        name: "is_island_nation",
        value: kitchenSinkTestcase.data.is_island_nation,
        state: "unused",
    },
    {
        name: "notes",
        value: kitchenSinkTestcase.data.notes,
        state: "unused",
    },
    {
        name: "correct_answer",
        value: kitchenSinkTestcase.data.correct_answer,
        state: "unused",
    },
    {
        name: "metadata",
        value: kitchenSinkTestcase.data.metadata,
        state: "unused",
    },
    {
        name: "geo.region",
        value: kitchenSinkTestcase.data["geo.region"],
        state: "unused",
    },
]

// Toggle to bring back the focused-fixture rows (chip-showcase, messages
// trace, markdown article). Kept as a flag (rather than deleting them) so
// they're one edit away if a focused review is needed. Kitchen-sink Vanuatu
// (Row 1) covers every gap on its own.
const SHOW_EXTRA_ROWS = false

// The 4-prompt chain that drives the kitchen-sink Vanuatu execution item.
// Variable references match KITCHEN_SINK_VARIABLE_MAP — `country` and
// `messages` are used by every prompt; `geo` and `languages` are partial
// (chain state); `iso_code` is referenced but not on the testcase yet
// (draft state). Defined here so the prompt config view above the
// execution items reads as the contract that the playground row resolves.
const KITCHEN_SINK_PROMPT_CHAIN: PromptConfig[] = [
    {
        step: 1,
        name: "Languages briefing",
        template:
            "Brief the user on languages spoken in {{country}}. Reference: {{languages}}.",
        variables: [
            {name: "country", state: "resolved"},
            {name: "languages", state: "resolved"},
        ],
    },
    {
        step: 2,
        name: "Geography lookup",
        template:
            "Look up {{country}} ({{iso_code}}) in the {{geo}} region. Continue the conversation: {{messages}}.",
        variables: [
            {name: "country", state: "resolved"},
            {name: "iso_code", state: "draft"},
            {name: "geo", state: "resolved"},
            {name: "messages", state: "resolved"},
        ],
    },
    {
        step: 3,
        name: "Capital answer",
        template:
            "What is the capital of {{country}}? Use {{geo}} for context. Build on prior turns: {{messages}}.",
        variables: [
            {name: "country", state: "resolved"},
            {name: "geo", state: "resolved"},
            {name: "messages", state: "resolved"},
        ],
    },
    {
        step: 4,
        name: "Final response",
        template:
            "Format the final answer for {{country}}. Conversation so far: {{messages}}.",
        variables: [
            {name: "country", state: "resolved"},
            {name: "messages", state: "resolved"},
        ],
    },
]

// Variables actually referenced by the chain (any prompt). Used to filter
// the execution-item inputs body so the user only sees what the prompts
// pull in — not the full 12-column testcase dump. Mahmoud's 2026-05-05
// feedback: "extremely complex, definitely not the right solution for
// SME" was driven by exactly that overload.
const IN_USE_VARIABLE_NAMES = new Set(
    KITCHEN_SINK_VARIABLE_MAP.filter(
        (v) => v.state === "used" || v.state === "chain" || v.state === "draft",
    ).map((v) => v.name),
)

const UNUSED_VARIABLE_NAMES = KITCHEN_SINK_VARIABLE_MAP.filter(
    (v) => v.state === "unused",
).map((v) => v.name)

// In-use inputs passed to the proposed (Embedded + Compact) execution items.
// Built from KITCHEN_SINK_VARIABLE_MAP — only `used` / `chain` / `draft`
// variables. Draft variables (e.g. `iso_code`) get an explicit `undefined`
// value so the row renders the "draft" treatment instead of a missing key.
const KITCHEN_SINK_IN_USE_INPUTS = KITCHEN_SINK_VARIABLE_MAP.filter(
    (v) => v.state !== "unused",
).map((v) => ({
    name: v.name,
    value:
        v.value !== undefined
            ? v.value
            : (kitchenSinkTestcase.data as Record<string, unknown>)[v.name],
}))

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
                        <strong>The three panels:</strong>
                        <ul style={styles.notesList}>
                            <li>
                                <strong>Today</strong>: production playground.
                                Borderless textarea per input. No chips, no
                                output rendering until Run. Long-form fields
                                use the production Lexical editor with the
                                visible <code>MarkdownToggleButton</code>.
                            </li>
                            <li>
                                <strong>Proposed (embedded)</strong>: inputs
                                body is <code>ProposedDrillIn</code>, so the
                                gap-01..06 decisions land here directly. Type
                                chips, type-switching popover, long-form
                                editor toggle, chat cards for messages, and a
                                clickable output chip in read-only mode.
                                Tradeoff: 6+ inputs scroll.
                            </li>
                            <li>
                                <strong>Alt (compact)</strong>: one ~26px row
                                per input. Click primitives → row morphs to
                                inline editor. Click structured rows → expand
                                inline. Long-form fields hydrate to{" "}
                                <code>[markdown]</code> automatically.
                                Tradeoff: deep nesting still mounts a drill-in
                                mid-list, breaking the density story.
                            </li>
                        </ul>
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

                <section style={styles.gap09Section}>
                    <header style={styles.gap09Header}>
                        <span style={styles.gap09Tag}>gap-09</span>
                        <h2 style={styles.gap09Title}>
                            Variable provenance + usage map
                        </h2>
                    </header>
                    <p style={styles.gap09Lead}>
                        Each variable in the execution item carries a 2-axis
                        state: <em>authoring side</em> (on the testcase, or a
                        draft from prompt typing not yet synced) and{" "}
                        <em>usage side</em> (referenced by every prompt, by
                        some prompts in a chain, or by none). Today's
                        playground renders all variables identically; the
                        proposed map below collapses the unused ones, marks
                        drafts with a dashed border, and shows chain scope
                        per row.
                    </p>
                    <PlaygroundVariableMap
                        variables={KITCHEN_SINK_VARIABLE_MAP}
                        chainLength={4}
                    />
                </section>

                <section style={styles.promptConfigSection}>
                    <header style={styles.promptConfigHeader}>
                        <span style={styles.promptConfigTag}>config</span>
                        <h2 style={styles.promptConfigTitle}>
                            Prompt chain that drives this execution item
                        </h2>
                    </header>
                    <p style={styles.promptConfigLead}>
                        The 4-prompt chain. Every <code>{`{{var}}`}</code>{" "}
                        token below is what the execution-item inputs (in
                        the grid further down) need to resolve. Showing the
                        config here means the user reads "what the prompt
                        needs" before "what the testcase has" — addresses
                        the SME-complexity feedback (2026-05-05).
                    </p>
                    <PromptConfigView prompts={KITCHEN_SINK_PROMPT_CHAIN} />
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

                    {/* Row 1 — Kitchen sink Vanuatu (every gap on one row).
                        Today panel shows the full testcase dump (production
                        behavior — no filtering). Embedded + Compact filter
                        to in-use variables only so the proposed surfaces
                        actually demonstrate what they're proposing: a
                        focused inputs body, not a column dump. The unused
                        columns stay reachable via the Variable map above. */}
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
                        inputs={KITCHEN_SINK_IN_USE_INPUTS}
                        unusedTestcaseColumns={UNUSED_VARIABLE_NAMES}
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
                        inputs={KITCHEN_SINK_IN_USE_INPUTS}
                        unusedTestcaseColumns={UNUSED_VARIABLE_NAMES}
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
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-09-variable-provenance" style={styles.link}>
                        gap-09 (variable provenance, execution-item surface)
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
    gap09Section: {
        padding: 16,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        marginBottom: 24,
    },
    gap09Header: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 6,
    },
    gap09Tag: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        background: "#d6e4ff",
        color: "#1d39c4",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    gap09Title: {
        fontSize: 14,
        fontWeight: 700,
        margin: 0,
        color: "#051729",
    },
    gap09Lead: {
        fontSize: 12,
        color: "rgba(5, 23, 41, 0.65)",
        lineHeight: 1.6,
        margin: "0 0 12px",
    },
    promptConfigSection: {
        padding: 16,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        marginBottom: 24,
    },
    promptConfigHeader: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 6,
    },
    promptConfigTag: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        background: "#e6f4ff",
        color: "#1677ff",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    promptConfigTitle: {
        fontSize: 14,
        fontWeight: 700,
        margin: 0,
        color: "#051729",
    },
    promptConfigLead: {
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
