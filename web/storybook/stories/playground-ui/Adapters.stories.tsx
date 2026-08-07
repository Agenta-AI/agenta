import type {ReactNode} from "react"

import {loadableStateAtomFamily} from "@agenta/entities/runnable"
import {playgroundNodesAtom} from "@agenta/playground/state"
import {TurnMessageAdapter, VariableControlAdapter} from "@agenta/playground-ui/adapters"
import {Button} from "@agenta/ui/ui"
import {Database} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

import {APP_ID, linkedLoadableState, loadableIdFor, node, revisionQuery} from "./_fixtures/outputs"

/**
 * The two adapters — the components that sit between the playground's atom graph and the
 * presentational editors. `TurnMessageAdapter` (814 lines) is the largest antd-free file in
 * the package; `VariableControlAdapter` (578) is the schema-aware input control.
 *
 * Showcases, not parity rows. Neither file imports an antd component any more — what antd is
 * left in their subtrees (`SharedEditor`, `InputNumber`, `Switch`, `Tooltip`) is pixel-gated by
 * those components' own `--antd-vs-agenta` stories. What is worth covering here is that each
 * adapter still routes its input to the right editor after the swap.
 *
 * ## The two seams
 *
 * **`TurnMessageAdapter` has a prop escape hatch.** Its `msg` is normally looked up in the flat
 * message store by `(rowId, kind, sessionId, toolIndex)`, but the very first line of that memo
 * is `if (messageOverride) return messageOverride`. So a story hands it a `SimpleChatMessage`
 * directly and needs no chat state at all. **Without a message the component renders `null`** —
 * the final ternary is `… : msg ? (…) : null` — so every story here passes one.
 *
 * **`VariableControlAdapter` has none.** Everything it shows comes from atoms:
 * `inputPortSchemaMap` picks the editor, `variableKeys` decides whether the label renders at
 * all (`variableKeys.includes(variableKey) ? name : undefined`), and `testcaseCellValue` holds
 * the value. Two writable atoms reach the first two:
 *
 * - `playgroundNodesAtom` + a seeded revision whose `data.schemas.inputs.properties` declares
 *   the ports → `inputPortSchemaMap`.
 * - `loadableStateAtomFamily(loadableId)` with `linkedRunnableType`/`linkedRunnableId` set →
 *   `loadableController.selectors.columns` → `variableKeys`, which is what makes the label
 *   appear. Skip it and every control renders anonymously — silently, with no failing gate.
 *
 * The VALUES are the exception: `testcaseCellValue` reads `testcaseMolecule.atoms.cell`, so the
 * cells below are empty and show their placeholders. Populated cells need the seeded-loadable
 * helper (`_fixtures/playgroundLoadable.ts`); see `Outputs.stories.tsx` for the same caveat.
 */
const meta = {
    title: "@agenta/playground-ui/Adapters",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component: "Turn message adapter and the schema-aware variable control.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const Case = ({label, children}: {label: string; children: ReactNode}) => (
    <section className="flex flex-col gap-1 border-b border-colorBorderSecondary py-4">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="group/item">{children}</div>
    </section>
)

const ROW = "turn-1"
const ENTITY = "rev-chat-adapters"

/** No fixtures, no gate — the turn adapter is driven entirely by `messageOverride`. */
const noNetwork = {agenta: {session: false, queries: [], atoms: [[playgroundNodesAtom, []]]}}

// ---------------------------------------------------------------------------
// TurnMessageAdapter
// ---------------------------------------------------------------------------

/**
 * One turn per `kind`. The header toolbar (`TurnMessageHeaderOptions`) is `invisible` until
 * the surrounding `group/item` is hovered, so it is present in the DOM but not in a static
 * screenshot — that is the real behaviour, and `TurnMessageHeaderOptions.stories.tsx` is where
 * the toolbar itself is shown forced-visible.
 */
export const TurnKinds: Story = {
    parameters: noNetwork,
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Case label="user — role select, 'Type your message…' placeholder">
                <TurnMessageAdapter
                    entityId={ENTITY}
                    rowId={ROW}
                    kind="user"
                    messageOverride={{
                        id: "m-user",
                        role: "user",
                        content: "Where is my refund? Order A-4471.",
                    }}
                />
            </Case>
            <Case label="assistant — plain text reply">
                <TurnMessageAdapter
                    entityId={ENTITY}
                    rowId={ROW}
                    kind="assistant"
                    messageOverride={{
                        id: "m-asst",
                        role: "assistant",
                        content: "It was issued on 3 July and lands within 5 business days.",
                    }}
                />
            </Case>
            <Case label="tool — ToolCallViewHeader above the body (call id + name)">
                <TurnMessageAdapter
                    entityId={ENTITY}
                    rowId={ROW}
                    kind="tool"
                    messageOverride={{
                        id: "m-tool",
                        role: "tool",
                        name: "lookup_order",
                        tool_call_id: "call_1",
                        content: '{"status":"refunded","issued_at":"2026-07-03"}',
                    }}
                />
            </Case>
            <Case label="error — role 'Error' forces the read-only state and red text">
                <TurnMessageAdapter
                    entityId={ENTITY}
                    rowId={ROW}
                    kind="assistant"
                    messageOverride={{
                        id: "m-err",
                        role: "Error",
                        content: "Upstream returned 502 after 3 retries.",
                    }}
                />
            </Case>
        </div>
    ),
}

/**
 * `tool_calls` on an assistant message takes a completely different path: the adapter maps
 * `createToolCallPayloads` and renders ONE editor per call, each with its own
 * `ToolCallViewHeader`, instead of the single-message editor.
 *
 * These turns also **auto-collapse on mount** (`autoMinimizedRef`, once only) — `getCollapseStyle`
 * caps the editor at 68px with its own scrollbar, so a long arguments blob is clipped here on
 * purpose rather than truncated.
 */
export const TurnWithToolCalls: Story = {
    parameters: noNetwork,
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Case label="one tool call">
                <TurnMessageAdapter
                    entityId={ENTITY}
                    rowId={ROW}
                    kind="assistant"
                    messageOverride={{
                        id: "m-tc1",
                        role: "assistant",
                        content: "",
                        tool_calls: [
                            {
                                id: "call_1",
                                type: "function",
                                function: {
                                    name: "lookup_order",
                                    arguments: '{"order_id":"A-4471"}',
                                },
                            },
                        ],
                    }}
                />
            </Case>
            <Case label="two tool calls — one editor per call">
                <TurnMessageAdapter
                    entityId={ENTITY}
                    rowId={ROW}
                    kind="assistant"
                    messageOverride={{
                        id: "m-tc2",
                        role: "assistant",
                        content: "",
                        tool_calls: [
                            {
                                id: "call_a",
                                type: "function",
                                function: {name: "lookup_order", arguments: '{"order_id":"A-1"}'},
                            },
                            {
                                id: "call_b",
                                type: "function",
                                function: {
                                    name: "refund_policy",
                                    arguments: '{"region":"eu","tier":"pro"}',
                                },
                            },
                        ],
                    }}
                />
            </Case>
        </div>
    ),
}

/**
 * Content shapes and the slots a caller can fill.
 *
 * The JSON case documents a non-obvious behaviour: `editorText` tries `JSON5.parse` on any
 * content that starts with `{` or `[` and re-serialises it pretty-printed, so a minified blob
 * arrives at the editor already formatted.
 */
export const TurnContentAndSlots: Story = {
    parameters: noNetwork,
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Case label="JSON content — re-serialised through JSON5 before it reaches the editor">
                <TurnMessageAdapter
                    entityId={ENTITY}
                    rowId={ROW}
                    kind="assistant"
                    messageOverride={{
                        id: "m-json",
                        role: "assistant",
                        content: '{"intent":"refund","confidence":0.92,"entities":["A-4471"]}',
                    }}
                />
            </Case>
            <Case label="content parts — text + image, attachments strip in the footer">
                <TurnMessageAdapter
                    entityId={ENTITY}
                    rowId={ROW}
                    kind="user"
                    messageOverride={{
                        id: "m-img",
                        role: "user",
                        content: [
                            {type: "text", text: "Does this receipt look right?"},
                            {
                                type: "image_url",
                                image_url: {
                                    url:
                                        "data:image/svg+xml;base64," +
                                        btoa(
                                            '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#c8d2dc"/></svg>',
                                        ),
                                },
                            },
                        ],
                    }}
                />
            </Case>
            <Case label="empty user turn — placeholder only">
                <TurnMessageAdapter
                    entityId={ENTITY}
                    rowId={ROW}
                    kind="user"
                    messageOverride={{id: "m-empty", role: "user", content: ""}}
                />
            </Case>
            <Case label="disabled">
                <TurnMessageAdapter
                    entityId={ENTITY}
                    rowId={ROW}
                    kind="user"
                    disabled
                    messageOverride={{id: "m-dis", role: "user", content: "Frozen turn."}}
                />
            </Case>
            <Case label="footer + headerRight + renderTestsetButton slots">
                <TurnMessageAdapter
                    entityId={ENTITY}
                    rowId={ROW}
                    kind="assistant"
                    messageOverride={{
                        id: "m-slots",
                        role: "assistant",
                        content: "Refund issued.",
                    }}
                    headerRight={
                        <span className="text-[11px] text-colorTextDescription">gpt-4o-mini</span>
                    }
                    footer={
                        <span className="text-[11px] text-colorTextDescription">
                            842ms · 310 tokens
                        </span>
                    }
                    renderTestsetButton={({disabled}) => (
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Add to testset"
                            disabled={disabled}
                        >
                            <Database size={14} />
                        </Button>
                    )}
                    results={[{output: "Refund issued."}]}
                />
            </Case>
        </div>
    ),
}

/**
 * No `messageOverride` and no seeded chat store, so the message lookup finds nothing and the
 * adapter returns `null`. Empty below the caption is the correct render — and it is the failure
 * mode to watch for in every other story on this page, since a missing message looks exactly
 * like a passing screenshot.
 */
export const TurnNoMessage: Story = {
    parameters: noNetwork,
    render: () => (
        <div className="flex max-w-[760px] flex-col gap-2">
            <div className="text-xs text-colorTextSecondary">
                No message resolves for this (rowId, kind, sessionId), so the adapter renders null.
                The dashed box below is empty on purpose.
            </div>
            <div className="rounded border border-dashed border-colorBorderSecondary p-3">
                <TurnMessageAdapter entityId={ENTITY} rowId="turn-missing" kind="assistant" />
            </div>
        </div>
    ),
}

// ---------------------------------------------------------------------------
// VariableControlAdapter
// ---------------------------------------------------------------------------

/** Seeds ports + loadable columns for one workflow; see the file header for why both. */
const withPorts = (
    inputs: Record<string, {type: string; title?: string}>,
    opts: {isEvaluator?: boolean} = {},
) => ({
    agenta: {
        session: false,
        queries: (scope: StoryScope) => [
            revisionQuery(scope.projectId, APP_ID, {
                name: "classify",
                version: 3,
                inputs,
                ...opts,
            }),
        ],
        atoms: [
            [playgroundNodesAtom, [node(APP_ID, 0, "classify")]],
            [
                loadableStateAtomFamily(loadableIdFor(APP_ID)),
                linkedLoadableState(APP_ID, "classify"),
            ],
        ],
    },
})

/**
 * One control per declared port type — this is the adapter's whole job. The branch is chosen
 * from `inputPortSchemaMap[key].type`, NOT from the cell value, so an empty cell still gets the
 * right widget.
 *
 * Cells are empty (no testcase entity is seeded — see the file header), so each control shows
 * its placeholder or zero-value. That is the pre-fill state a fresh row actually has.
 */
export const VariableByPortType: Story = {
    parameters: withPorts({
        question: {type: "string", title: "question"},
        top_k: {type: "integer", title: "top_k"},
        temperature: {type: "number", title: "temperature"},
        stream: {type: "boolean", title: "stream"},
        filters: {type: "object", title: "filters"},
        tags: {type: "array", title: "tags"},
    }),
    render: () => (
        <div className="flex max-w-[620px] flex-col">
            <Case label="string — SharedEditor with the view-mode dropdown">
                <VariableControlAdapter entityId={APP_ID} rowId="row-1" variableKey="question" />
            </Case>
            <Case label="integer — InputNumber">
                <VariableControlAdapter entityId={APP_ID} rowId="row-1" variableKey="top_k" />
            </Case>
            <Case label="number — InputNumber (same branch)">
                <VariableControlAdapter entityId={APP_ID} rowId="row-1" variableKey="temperature" />
            </Case>
            <Case label="boolean — Switch (onChange → onCheckedChange)">
                <VariableControlAdapter entityId={APP_ID} rowId="row-1" variableKey="stream" />
            </Case>
            <Case label="object — json-object TypeChip, code editor once view mode flips">
                <VariableControlAdapter entityId={APP_ID} rowId="row-1" variableKey="filters" />
            </Case>
            <Case label="array — json-array TypeChip">
                <VariableControlAdapter entityId={APP_ID} rowId="row-1" variableKey="tags" />
            </Case>
        </div>
    ),
}

/**
 * The chrome around the control.
 *
 * `unknown_var` is the one to read carefully: the key is not in `variableKeys`, so `name` is
 * `undefined` and the header renders an EMPTY label. That is the adapter's real behaviour for
 * a stale key, and it is why the `loadableStateAtomFamily` seed is load-bearing — without it
 * every control on this page would look like that one.
 */
export const VariableChrome: Story = {
    parameters: withPorts({
        question: {type: "string", title: "question"},
        top_k: {type: "integer", title: "top_k"},
    }),
    render: () => (
        <div className="flex max-w-[620px] flex-col">
            <Case label="placeholder override">
                <VariableControlAdapter
                    entityId={APP_ID}
                    rowId="row-1"
                    variableKey="question"
                    placeholder="Ask the assistant something…"
                />
            </Case>
            <Case label="disabled">
                <VariableControlAdapter
                    entityId={APP_ID}
                    rowId="row-1"
                    variableKey="question"
                    disabled
                />
            </Case>
            <Case label="headerActions — composed AFTER the view-mode dropdown">
                <VariableControlAdapter
                    entityId={APP_ID}
                    rowId="row-1"
                    variableKey="question"
                    headerActions={
                        <Button variant="ghost" size="icon" aria-label="Add to testset">
                            <Database size={14} />
                        </Button>
                    }
                />
            </Case>
            <Case label="hideLabel — borderless, no header (the generation-row cell strip)">
                <VariableControlAdapter
                    entityId={APP_ID}
                    rowId="row-1"
                    variableKey="question"
                    hideLabel
                />
            </Case>
            <Case label="collapsed — --editor-h capped at 68px, body scrolls">
                <VariableControlAdapter
                    entityId={APP_ID}
                    rowId="row-1"
                    variableKey="question"
                    collapsed
                />
            </Case>
            <Case label="view='focus' — drops the border in single view">
                <VariableControlAdapter
                    entityId={APP_ID}
                    rowId="row-1"
                    variableKey="top_k"
                    view="focus"
                />
            </Case>
            <Case label="key not in variableKeys — the label renders EMPTY (stale-key behaviour)">
                <VariableControlAdapter entityId={APP_ID} rowId="row-1" variableKey="unknown_var" />
            </Case>
        </div>
    ),
}

/**
 * `appType="custom"` disables every control whose name is not in `schemaInputKeys` — the keys
 * the runnable's request payload actually declares. Nothing seeds a request payload here, so
 * the allow-list is empty and both controls come out disabled, which is the gate doing its job
 * rather than a broken fixture.
 */
export const VariableCustomAppGating: Story = {
    parameters: withPorts({
        question: {type: "string", title: "question"},
        top_k: {type: "integer", title: "top_k"},
    }),
    render: () => (
        <div className="flex max-w-[620px] flex-col">
            <Case label="appType='custom' — string control gated off">
                <VariableControlAdapter
                    entityId={APP_ID}
                    rowId="row-1"
                    variableKey="question"
                    appType="custom"
                />
            </Case>
            <Case label="appType='custom' — number control gated off">
                <VariableControlAdapter
                    entityId={APP_ID}
                    rowId="row-1"
                    variableKey="top_k"
                    appType="custom"
                />
            </Case>
        </div>
    ),
}

/**
 * Evaluator revisions do not get schema-derived ports — `inputPorts` short-circuits to
 * `buildEvaluatorEnvelopePorts`, which returns the `inputs` / `outputs` envelope pair with a
 * `helpText`. That help text is the only thing that renders the info icon next to the label
 * (deliberately on the LEFT, outside the hover-gated action cluster, so it stays visible).
 *
 * The tooltip body itself is hover-gated and never appears in a static shot; the icon is.
 */
export const VariableEvaluatorEnvelope: Story = {
    parameters: withPorts({}, {isEvaluator: true}),
    render: () => (
        <div className="flex max-w-[620px] flex-col">
            <Case label="inputs — object envelope, info icon from helpText">
                <VariableControlAdapter entityId={APP_ID} rowId="row-1" variableKey="inputs" />
            </Case>
            <Case label="outputs — string envelope, info icon from helpText">
                <VariableControlAdapter entityId={APP_ID} rowId="row-1" variableKey="outputs" />
            </Case>
        </div>
    ),
}
