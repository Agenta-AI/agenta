/**
 * Already shipped — RFC pieces that landed ad-hoc before this design work.
 *
 * Several RFC items (WP-F3 prompt-editor autocomplete, JSONPath token
 * support, chain-context-aware envelope routing, template-variable
 * validation utilities) were built earlier in 2026 and merged independently
 * of the JSON↔String UX gap docs. This page is the inventory: what shipped,
 * where it lives, what it does, and how the proposed gaps compose with it.
 *
 * Goal: stop new gap proposals from accidentally re-specifying behaviors
 * that already exist; give engineers a single page that points at the
 * code so they can extend rather than duplicate.
 */

import Head from "next/head"
import Link from "next/link"

import {MockupPageShell} from "@/mockups/components/MockupPageShell"

export default function AlreadyShipped() {
    return (
        <>
            <Head>
                <title>Already shipped — RFC pieces that landed before this work</title>
            </Head>
            <MockupPageShell
                title="Already shipped — RFC pieces that landed before this work"
                blurb={
                    "Inventory of RFC items that were built ad-hoc earlier in 2026 and aren't in the gap docs. WP-F3 (prompt-editor autocomplete + JSONPath token typeahead) is already in production; gap-08 and gap-09 build on top of it. Listed here so new proposals don't accidentally re-specify what already exists."
                }
                notes={
                    <>
                        <strong>Why this page exists:</strong> the gap-01..09 docs read as if the
                        prompt-editor surface is green-field, but the token typeahead, JSONPath
                        envelope routing, and template-variable validation already ship. Several
                        open questions in gap-08 are actually wiring details on top of code that's
                        already running. Reference these file paths instead of redesigning them.
                    </>
                }
            >
                <Section
                    tag="WP-F3"
                    title="Prompt-editor token typeahead — flat + JSONPath"
                    summary="Authoring `{{name}}` or `{{$.path}}` in any prompt editor pops a Lexical-driven typeahead. Both modes share one suggestion contract; the dispatcher decides which envelope slot to query based on the path prefix."
                    items={[
                        {
                            label: "Lexical token plugin family",
                            detail: (
                                <>
                                    <code>web/packages/agenta-ui/src/editor/plugins/token/</code>
                                    <ul style={styles.fileList}>
                                        <li>
                                            <code>TokenNode.ts</code> · custom Lexical node for{" "}
                                            <code>{"{{...}}"}</code> tokens
                                        </li>
                                        <li>
                                            <code>TokenInputNode.tsx</code> · input mode (active
                                            typing inside the braces)
                                        </li>
                                        <li>
                                            <code>TokenPlugin.tsx</code> (239 LOC) · bracket
                                            detection + token conversion + navigation
                                        </li>
                                        <li>
                                            <code>AutoCloseTokenBracesPlugin.tsx</code> (200 LOC) ·
                                            auto-pair <code>{"{{"}</code> → <code>{"{{}}"}</code>
                                        </li>
                                        <li>
                                            <code>TokenTypeaheadPlugin.tsx</code> (403 LOC) ·
                                            suggestion dropdown, parses path / flat mode, drives the
                                            dispatcher
                                        </li>
                                        <li>
                                            <code>TokenTooltipPlugin.tsx</code> (120 LOC) · hover
                                            tooltip showing resolved value + validation hint
                                        </li>
                                        <li>
                                            <code>TokenPathSuggestionsContext.tsx</code> (89 LOC) ·
                                            provider/getter contract used by the typeahead
                                        </li>
                                    </ul>
                                </>
                            ),
                        },
                        {
                            label: "Mode parsing",
                            detail: (
                                <>
                                    <code>parsePathContext()</code> in{" "}
                                    <code>TokenTypeaheadPlugin.tsx:74</code> handles both syntaxes:
                                    <pre style={styles.pre}>
                                        {`{{$.}}                  → mode: path,  prefix: [],                 current: ""
{{$.in}}                → mode: path,  prefix: [],                 current: "in"
{{$.inputs.}}           → mode: path,  prefix: ["inputs"],         current: ""
{{$.inputs.arda.test}}  → mode: path,  prefix: ["inputs","arda"],  current: "test"
{{co}}                  → mode: flat,  prefix: [],                 current: "co"
{{country.re}}          → mode: flat,  prefix: ["country"],        current: "re"`}
                                    </pre>
                                </>
                            ),
                        },
                        {
                            label: "Maps to gap-08",
                            detail: (
                                <>
                                    Gap-08 (
                                    <Link
                                        href="/gap-08-playground-variable-validation"
                                        style={styles.link}
                                    >
                                        playground variable validation
                                    </Link>
                                    ) builds on this — the symmetric edit-time check on the prompt
                                    surface uses the same parser + path splitter. The{" "}
                                    <code>[draft]</code> chip from gap-09 fires when this
                                    typeahead's suggestion set doesn't include the typed name.
                                </>
                            ),
                        },
                    ]}
                />

                <Section
                    tag="WP-F3"
                    title="Envelope-aware suggestion dispatcher"
                    summary="Per-envelope source modules (inputs / outputs / parameters / testcase) self-subscribe to their data, own their depth policy, and return path-aware suggestions. The dispatcher is trivial — it routes by the first segment of the path."
                    items={[
                        {
                            label: "Source contract",
                            detail: (
                                <>
                                    <code>
                                        web/oss/src/components/Playground/PlaygroundTokenPath/types.ts
                                    </code>{" "}
                                    defines <code>EnvelopeSource</code> with one method:{" "}
                                    <code>getSuggestions(afterSlot, query)</code>. Each source
                                    returns the suggestions for a single envelope slot; the
                                    dispatcher picks the source matching the first path segment.
                                </>
                            ),
                        },
                        {
                            label: "Source implementations",
                            detail: (
                                <>
                                    <code>
                                        web/oss/src/components/Playground/PlaygroundTokenPath/sources/
                                    </code>
                                    <ul style={styles.fileList}>
                                        <li>
                                            <code>inputs.ts</code> (135 LOC) · port schemas +
                                            observed testcase keys, depth-2 walk
                                        </li>
                                        <li>
                                            <code>outputs.ts</code> (94 LOC) · upstream-node output
                                            schema, scoped to the chain context
                                        </li>
                                        <li>
                                            <code>parameters.ts</code> (61 LOC) · evaluator
                                            parameters slot
                                        </li>
                                        <li>
                                            <code>testcase.ts</code> (43 LOC) · direct testcase row
                                            keys
                                        </li>
                                        <li>
                                            <code>shared.ts</code> (84 LOC) · common type/schema
                                            helpers
                                        </li>
                                    </ul>
                                </>
                            ),
                        },
                        {
                            label: "Dispatcher",
                            detail: (
                                <>
                                    <code>
                                        web/oss/src/components/Playground/PlaygroundTokenPath/index.tsx
                                    </code>{" "}
                                    exports two providers:
                                    <ul style={styles.fileList}>
                                        <li>
                                            <code>PlaygroundTokenPathProvider</code> · global,
                                            offers only <code>$.inputs</code> (covers detached
                                            editors with no node context).
                                        </li>
                                        <li>
                                            <code>PlaygroundNodeTokenPathProvider</code> · scoped
                                            per node, adds <code>$.outputs</code> when the node has
                                            an upstream connection in the playground DAG.
                                        </li>
                                    </ul>
                                </>
                            ),
                        },
                    ]}
                />

                <Section
                    tag="WP-F3"
                    title="Chain-context awareness"
                    summary="Typeahead suggestions match what the SDK actually binds at runtime. Depth-0 nodes (no upstream) only get $.inputs; depth>0 nodes (evaluators fed by a variant) also get $.outputs sourced from the upstream node's output-port schema."
                    items={[
                        {
                            label: "Anchor",
                            detail: (
                                <>
                                    <code>
                                        web/oss/src/components/Playground/PlaygroundTokenPath/chainContext.ts
                                    </code>{" "}
                                    · <code>nodeChainContextAtomFamily</code> derives{" "}
                                    <code>{"{allowedSlots, upstreamEntityId}"}</code> from{" "}
                                    <code>playgroundNodesAtom</code> +{" "}
                                    <code>outputConnectionController</code>.
                                </>
                            ),
                        },
                        {
                            label: "Why it matters",
                            detail: (
                                <>
                                    Mirrors what the SDK handlers actually inject —{" "}
                                    <code>auto_ai_critique_v0</code> receives <code>outputs</code>;{" "}
                                    <code>completion_v0</code> and <code>chat_v0</code> don't. The
                                    typeahead matches runtime reality, so suggestions for{" "}
                                    <code>$.outputs.*</code> never appear in a depth-0 editor where
                                    they'd be unreplaced tokens at format time.
                                </>
                            ),
                        },
                        {
                            label: "Maps to gap-09",
                            detail: (
                                <>
                                    Gap-09's chain-scoped variable badge (
                                    <code>prompt 1, 3 of 4</code>) reads from this same chain
                                    context. Per-prompt usage scope can join the suggestion-source
                                    map and the editor's parsed token list to produce the badge for
                                    free. See{" "}
                                    <Link href="/gap-09-variable-provenance" style={styles.link}>
                                        gap-09
                                    </Link>{" "}
                                    for the proposed UI.
                                </>
                            ),
                        },
                    ]}
                />

                <Section
                    tag="shared utility"
                    title="Template-variable validation utilities"
                    summary="A central registry of envelope slot names + a validator. Used by the typeahead to flag invalid roots (typos like {{$.input.x}}) and produce did-you-mean hints."
                    items={[
                        {
                            label: "Anchor",
                            detail: (
                                <>
                                    <code>
                                        web/packages/agenta-shared/src/utils/templateVariable.ts
                                    </code>
                                    <ul style={styles.fileList}>
                                        <li>
                                            <code>KNOWN_ENVELOPE_SLOTS</code> · the registry:{" "}
                                            <code>inputs</code>, <code>outputs</code>,{" "}
                                            <code>parameters</code>, <code>testcase</code>,{" "}
                                            <code>trace</code>, <code>revision</code>.
                                        </li>
                                        <li>
                                            <code>validateTemplateVariable(expr)</code> · returns{" "}
                                            <code>{"{valid, reason?, suggestion?}"}</code> for use
                                            in the editor's red-bordered invalid-token tooltip.
                                        </li>
                                        <li>
                                            <code>suggestEnvelopeSlot(typed)</code> · "did you
                                            mean…?" for near-miss typos (e.g. <code>input</code> →{" "}
                                            <code>inputs</code>).
                                        </li>
                                    </ul>
                                </>
                            ),
                        },
                        {
                            label: "Validation rules already enforced",
                            detail: (
                                <>
                                    <ul style={styles.list}>
                                        <li>
                                            JSONPath roots MUST be a known envelope slot.{" "}
                                            <code>$.input.x</code> is rejected with a "did you mean
                                            inputs?" suggestion.
                                        </li>
                                        <li>
                                            Empty segments (<code>$.inputs..country</code>) are
                                            rejected with a duplicated-separator hint.
                                        </li>
                                        <li>
                                            Plain flat names are permissive — the registry can't
                                            validate them structurally without more context (which
                                            is what gap-08 adds via the schema entity).
                                        </li>
                                    </ul>
                                </>
                            ),
                        },
                        {
                            label: "Maps to gap-05 + gap-08",
                            detail: (
                                <>
                                    Gap-05's literal-key-first templating story uses the same
                                    parser. Gap-08's per-variable tooltip extends the existing
                                    invalid-token mechanism to "valid syntax but not in the attached
                                    testset's schema" once the schema entity (gap-07) lands.
                                </>
                            ),
                        },
                    ]}
                />

                <Section
                    tag="not yet shipped"
                    title="What this page does NOT cover"
                    summary="The visible parts of the variables panel and schema-aware behaviors are in the gap docs. This page is just the plumbing."
                    items={[
                        {
                            label: "Visible variables panel",
                            detail: (
                                <>
                                    The right-side panel listing "discovered from prompt" +
                                    "available from testcase context" + "available from trace
                                    context" exists only as a wireframe in{" "}
                                    <code>
                                        docs/designs/json-string-ux/archive/05-playground-variables.md
                                    </code>
                                    . Not built. Most of what gap-08's banner + tooltip propose
                                    lives in this archived doc.
                                </>
                            ),
                        },
                        {
                            label: "Schema-aware validation",
                            detail: (
                                <>
                                    "This path isn't in your dataset" requires{" "}
                                    <Link href="/gap-07-schema-aware-form" style={styles.link}>
                                        gap-07
                                    </Link>{" "}
                                    (per-testset schema entity). Without it, the typeahead can
                                    validate envelope slots but not flat-name references against the
                                    actual data contract.
                                </>
                            ),
                        },
                        {
                            label: "Variable provenance map",
                            detail: (
                                <>
                                    The execution-item-side variable map is{" "}
                                    <Link href="/gap-09-variable-provenance" style={styles.link}>
                                        gap-09
                                    </Link>
                                    . The chain context + token suggestions are the inputs; the
                                    rendering proposed there is new.
                                </>
                            ),
                        },
                    ]}
                />

                <div style={styles.crossLinks}>
                    <strong>Related concept pages:</strong>{" "}
                    <Link href="/gap-08-playground-variable-validation" style={styles.link}>
                        gap-08 (variable validation extends this)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-09-variable-provenance" style={styles.link}>
                        gap-09 (variable map composes this with chain context)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-05-dot-key-disambiguation" style={styles.link}>
                        gap-05 (literal-vs-nested at the prompt surface)
                    </Link>{" "}
                    ·{" "}
                    <Link href="/gap-07-schema-aware-form" style={styles.link}>
                        gap-07 (schema entity raises the validation ceiling)
                    </Link>
                </div>
            </MockupPageShell>
        </>
    )
}

interface SectionItem {
    label: string
    detail: React.ReactNode
}

interface SectionProps {
    tag: string
    title: string
    summary: string
    items: SectionItem[]
}

function Section({tag, title, summary, items}: SectionProps) {
    return (
        <section style={styles.section}>
            <header style={styles.sectionHeader}>
                <span style={styles.sectionTag}>{tag}</span>
                <h2 style={styles.sectionTitle}>{title}</h2>
            </header>
            <p style={styles.sectionSummary}>{summary}</p>
            <ul style={styles.itemList}>
                {items.map((item) => (
                    <li key={item.label} style={styles.item}>
                        <span style={styles.itemLabel}>{item.label}</span>
                        <div style={styles.itemDetail}>{item.detail}</div>
                    </li>
                ))}
            </ul>
        </section>
    )
}

const styles = {
    section: {
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
    },
    sectionHeader: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 6,
    },
    sectionTag: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        background: "#f6ffed",
        color: "#389e0d",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    sectionTitle: {
        fontSize: 15,
        fontWeight: 700,
        margin: 0,
        color: "#051729",
    },
    sectionSummary: {
        fontSize: 12,
        color: "rgba(5, 23, 41, 0.65)",
        lineHeight: 1.6,
        margin: "0 0 12px",
    },
    itemList: {
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column" as const,
        gap: 10,
    },
    item: {
        display: "grid",
        gridTemplateColumns: "180px 1fr",
        gap: 12,
        paddingTop: 8,
        borderTop: "1px solid rgba(5, 23, 41, 0.06)",
    },
    itemLabel: {
        fontSize: 12,
        fontWeight: 600,
        color: "rgba(5, 23, 41, 0.85)",
    },
    itemDetail: {
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.7,
    },
    fileList: {
        listStyle: "disc" as const,
        paddingLeft: 18,
        margin: "6px 0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
        lineHeight: 1.7,
    },
    list: {
        listStyle: "disc" as const,
        paddingLeft: 18,
        margin: "6px 0",
        lineHeight: 1.7,
    },
    pre: {
        background: "#fafafa",
        border: "1px solid rgba(5, 23, 41, 0.06)",
        borderRadius: 4,
        padding: "8px 10px",
        fontSize: 11,
        lineHeight: 1.6,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        margin: "6px 0",
        overflowX: "auto" as const,
    },
    link: {color: "#1677ff", fontWeight: 500},
    crossLinks: {
        marginTop: 16,
        padding: "10px 14px",
        background: "#fafafa",
        border: "1px solid rgba(5, 23, 41, 0.06)",
        borderRadius: 8,
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.8,
    },
}
