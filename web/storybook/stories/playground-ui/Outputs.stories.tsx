import type {ReactNode} from "react"

import {loadableStateAtomFamily, type RunnablePort} from "@agenta/entities/runnable"
import {playgroundNodesAtom, resultsByKeyAtomFamily} from "@agenta/playground/state"
import {PlaygroundOutputs} from "@agenta/playground-ui"
// `ExecutionHeader` / `ExecutionResultView` are NOT re-exported from the package root — the
// root index forwards only `PlaygroundOutputs` out of this group. `./components` is their
// only public entry point.
import {ExecutionHeader, ExecutionResultView} from "@agenta/playground-ui/components"
import {PlaygroundInputsBodyHost} from "@agenta/playground-ui/playground-inputs-body"
import {Button} from "@agenta/ui/ui"
import {Database} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

import {
    APP_B_ID,
    APP_ID,
    downstreamResultKey,
    errorResult,
    EVAL_A_ID,
    EVAL_B_ID,
    evaluatorResult,
    linkedLoadableState,
    loadableIdFor,
    node,
    resultKey,
    revisionQuery,
    ROW_ID,
    SCORE_0_10,
    textResult,
} from "./_fixtures/outputs"

/**
 * The four components that render what a run produced: the results header, the unified result
 * renderer, the per-row outputs panel, and the atom-aware inputs host.
 *
 * Showcases, not parity rows. The antd these files carried (`Button`/`Tooltip` in
 * `ExecutionHeader`, `Tag` in `PlaygroundOutputs`) is already pixel-gated by the primitives'
 * own `--antd-vs-agenta` stories; what is worth covering at this level is that each RESULT
 * STATE still reaches its right branch after the swap.
 *
 * ## How these get their data (the part worth stealing)
 *
 * `PlaygroundOutputs` reads results through
 * `executionItemController.selectors.fullResult({rowId, entityId})`, which looks like it needs
 * the whole execution-row graph. It does not. The chain is
 * `derivedLoadableIdAtom` → `resultAtomFamily({loadableId, stepId, sessionId})`, and:
 *
 * - `derivedLoadableIdAtom` derives purely from `playgroundNodesAtom` — a plain
 *   `PrimitiveAtom<PlaygroundNode[]>`. One depth-0 node fixes the loadable id to
 *   `testset:workflow:<entityId>`.
 * - `resultsByKeyAtomFamily(loadableId)` is a **writable** atom over the execution state.
 *
 * So two entries in `parameters.agenta.atoms` seed the whole outputs surface — no seeded
 * loadable, no testcase molecule. Key formats are documented in `_fixtures/outputs.ts`; the
 * downstream (evaluator) one is the easy mistake, since its results are stored under the
 * scoped id `` `${rootEntityId}:${nodeEntityId}` ``.
 *
 * Every story sets `session: false`. None of them wants a live query, and leaving the gate open
 * produces uncaught `AbortError` noise even where there is nothing to fetch.
 *
 * ## What is NOT covered
 *
 * `PlaygroundInputsBodyHost` is covered only as far as the CARDS — its variables render, but
 * every cell is empty, because the values live in the testcase molecule. That is the one thing
 * on this page that needs `_fixtures/playgroundLoadable.ts`; the full reasoning is in the
 * `InputsBodyHost` docblock at the bottom.
 */
const meta = {
    title: "@agenta/playground-ui/Outputs",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component: "Execution header, result renderer, outputs panel, inputs host.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Case = ({label, children}: {label: string; children: ReactNode}) => (
    <section className="flex flex-col gap-1 border-b border-colorBorderSecondary py-4">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        {children}
    </section>
)

const port = (key: string, type: string): RunnablePort => ({key, name: key, type})

const EVALUATOR_PORTS: RunnablePort[] = [
    port("score", "number"),
    port("success", "boolean"),
    port("reasoning", "string"),
]

// ---------------------------------------------------------------------------
// ExecutionResultView — fully prop-driven
// ---------------------------------------------------------------------------

/**
 * `ExecutionResultView` takes everything as props; its only two reads are
 * `playgroundController.selectors.isComparisonView` (false with no nodes seeded, the single
 * view) and the OPTIONAL `usePlaygroundUIOptional` — absent here, which is why no trace footer
 * appears under any result. That slot is an OSS component the package cannot import.
 *
 * Note the shape: `deriveToolViewModelFromResult` reads `result.response.data`, so a result
 * whose response is a bare string renders an empty editor rather than the text.
 */
export const ResultStates: Story = {
    parameters: {agenta: {session: false, queries: []}},
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Case label="running, no prior result — typing indicator only">
                <ExecutionResultView isRunning currentResult={null} traceId={null} />
            </Case>
            <Case label="re-running — indicator stacked above the previous answer">
                <ExecutionResultView
                    isRunning
                    currentResult={{response: {data: "Refunds land within 5 business days."}}}
                    traceId={null}
                />
            </Case>
            <Case label="text response">
                <ExecutionResultView
                    isRunning={false}
                    currentResult={{response: {data: "Refunds land within 5 business days."}}}
                    traceId={null}
                />
            </Case>
            <Case label="JSON response — code editor branch (isJSON)">
                <ExecutionResultView
                    isRunning={false}
                    currentResult={{
                        response: {data: '{"intent":"refund","confidence":0.92}'},
                    }}
                    traceId={null}
                />
            </Case>
            <Case label="tool call — routed to ToolCallView instead of the editor">
                <ExecutionResultView
                    isRunning={false}
                    currentResult={{
                        response: {
                            data: {
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
                            },
                        },
                    }}
                    traceId={null}
                />
            </Case>
            {/* `response.outputs` and NOT `response.data`: the evaluator branch is gated on
                `deriveToolViewModelFromResult` producing an empty `displayValue`, and that
                helper reads `response.data`. Put the fields under `data` and they render as a
                JSON blob in the editor instead of as a grid — silently. */}
            <Case label="evaluator-style output — extractDisplayEntries → field grid">
                <ExecutionResultView
                    isRunning={false}
                    currentResult={{
                        response: {
                            outputs: {
                                score: 7.5,
                                success: true,
                                reasoning: "Covers every required field.",
                            },
                        },
                    }}
                    traceId={null}
                    outputPorts={EVALUATOR_PORTS}
                    feedbackConfig={SCORE_0_10}
                />
            </Case>
            <Case label="error — read-only editor in the error state">
                <ExecutionResultView
                    isRunning={false}
                    currentResult={{error: "Upstream returned 502."}}
                    traceId={null}
                />
            </Case>
            <Case label="error — generic message replaced by metadata.rawError.detail + retry">
                <ExecutionResultView
                    isRunning={false}
                    currentResult={{
                        error: "An unknown error occurred",
                        metadata: {rawError: {detail: "Rate limit reached."}, retryAfter: 30},
                    }}
                    traceId={null}
                />
            </Case>
            <Case label="repetitions — nav strip above the answer">
                <ExecutionResultView
                    isRunning={false}
                    currentResult={{response: {data: "Answer 2 of 3."}}}
                    traceId={null}
                    repetitionProps={{current: 2, total: 3, onNext: noop, onPrev: noop}}
                />
            </Case>
            <Case label="no result, evaluator ports known — idle grid with em-dashes">
                <ExecutionResultView
                    isRunning={false}
                    currentResult={null}
                    traceId={null}
                    outputPorts={EVALUATOR_PORTS}
                />
            </Case>
            <Case label="no result, no ports — the click-run placeholder">
                <ExecutionResultView isRunning={false} currentResult={null} traceId={null} />
            </Case>
        </div>
    ),
}

/**
 * `showEmptyPlaceholder={false}` with no result and no ports returns `null`. Nothing rendering
 * below the caption is the correct outcome — this is the branch a comparison cell uses so an
 * unrun column collapses instead of repeating "click run" in every lane.
 */
export const ResultViewEmpty: Story = {
    parameters: {agenta: {session: false, queries: []}},
    render: () => (
        <div className="flex max-w-[720px] flex-col gap-2">
            <div className="text-xs text-colorTextSecondary">
                `showEmptyPlaceholder={"{false}"}` and no result — the component returns null, so
                the dashed box below is empty on purpose.
            </div>
            <div className="rounded border border-dashed border-colorBorderSecondary p-3">
                <ExecutionResultView
                    isRunning={false}
                    currentResult={null}
                    traceId={null}
                    showEmptyPlaceholder={false}
                />
            </div>
        </div>
    ),
}

// ---------------------------------------------------------------------------
// ExecutionHeader
// ---------------------------------------------------------------------------

const testsetActions = ({isRunning}: {isRunning: boolean}) => (
    <Button variant="outline" size="sm" disabled={isRunning}>
        <Database size={14} />
        Load testset
    </Button>
)

/**
 * The header adapts on ONE thing: whether `entityId` was passed. With it (single view) it gets
 * the collapse toggle and scopes the run to that entity; without it (comparison view) it drops
 * the toggle, shrinks to 40px and tints its background.
 *
 * No fixtures: `headerData` resolves to zero results / not running with nothing seeded, and
 * `isChatMode` is `undefined` (→ `false`) while `playgroundNodesAtom` is empty. That is exactly
 * the pre-run state, so it is worth seeing rather than worth seeding around.
 *
 * The run-all tooltip text varies with connected evaluators, but tooltips are hover-gated and
 * never appear in a static shot — `nodes` is left alone here for that reason.
 */
export const Header: Story = {
    parameters: {agenta: {session: false, queries: [], atoms: [[playgroundNodesAtom, []]]}},
    render: () => (
        <div className="flex max-w-[860px] flex-col gap-6">
            <Case label="single view — collapse toggle, Clear, Run all">
                <ExecutionHeader entityId={APP_ID} />
            </Case>
            <Case label="comparison view — no toggle, 40px, tinted band">
                <ExecutionHeader />
            </Case>
            <Case label="single view + testset slot (renderTestsetActions)">
                <ExecutionHeader entityId={APP_ID} renderTestsetActions={testsetActions} />
            </Case>
        </div>
    ),
}

// ---------------------------------------------------------------------------
// PlaygroundOutputs
// ---------------------------------------------------------------------------

/** One depth-0 node with a text answer — the ordinary single-variant playground row. */
export const OutputsSingle: Story = {
    parameters: {
        agenta: {
            session: false,
            queries: (scope: StoryScope) => [
                revisionQuery(scope.projectId, APP_ID, {name: "classify", version: 3}),
            ],
            atoms: [
                [playgroundNodesAtom, [node(APP_ID, 0, "classify")]],
                [
                    resultsByKeyAtomFamily(loadableIdFor(APP_ID)),
                    {
                        [resultKey(ROW_ID, APP_ID)]: textResult(
                            APP_ID,
                            "The refund was issued on 3 July and should land within 5 business days.",
                        ),
                    },
                ],
            ],
        },
    },
    render: () => (
        <div className="max-w-[760px]">
            <PlaygroundOutputs rowId={ROW_ID} primaryEntityId={APP_ID} />
        </div>
    ),
}

/**
 * A chain: the app plus two downstream evaluators, each in a different terminal state. Their
 * results hang off the SCOPED entity id (`${rootEntityId}:${nodeEntityId}`) — the single
 * easiest thing to get wrong here, and it fails silently as an idle card.
 */
export const OutputsWithEvaluators: Story = {
    parameters: {
        agenta: {
            session: false,
            queries: (scope: StoryScope) => [
                revisionQuery(scope.projectId, APP_ID, {name: "classify", version: 3}),
                revisionQuery(scope.projectId, EVAL_A_ID, {
                    name: "exact match",
                    isEvaluator: true,
                    outputs: {score: {type: "number"}, success: {type: "boolean"}},
                    feedbackConfig: SCORE_0_10,
                }),
                revisionQuery(scope.projectId, EVAL_B_ID, {
                    name: "llm judge",
                    isEvaluator: true,
                    outputs: {score: {type: "number"}, reasoning: {type: "string"}},
                }),
            ],
            atoms: [
                [
                    playgroundNodesAtom,
                    [
                        node(APP_ID, 0, "classify"),
                        node(EVAL_A_ID, 1, "exact match"),
                        node(EVAL_B_ID, 1, "llm judge"),
                    ],
                ],
                [
                    resultsByKeyAtomFamily(loadableIdFor(APP_ID)),
                    {
                        [resultKey(ROW_ID, APP_ID)]: textResult(APP_ID, "refund_request"),
                        [downstreamResultKey(ROW_ID, APP_ID, EVAL_A_ID)]: evaluatorResult(
                            `${APP_ID}:${EVAL_A_ID}`,
                            {score: 8, success: true},
                        ),
                        [downstreamResultKey(ROW_ID, APP_ID, EVAL_B_ID)]: errorResult(
                            `${APP_ID}:${EVAL_B_ID}`,
                            "Judge model timed out after 30s.",
                        ),
                    },
                ],
            ],
        },
    },
    render: () => (
        <div className="max-w-[760px]">
            <PlaygroundOutputs rowId={ROW_ID} primaryEntityId={APP_ID} />
        </div>
    ),
}

/**
 * Two depth-0 nodes flips `isComparisonView`, so the panel lays the variants out side by side
 * in a horizontally scrolling row of `min-w-[400px]` columns.
 *
 * Both columns read from the SAME loadable — the id is anchored on the first root node, so the
 * second variant's results are keyed on `sess:<its own entityId>` inside that one map.
 */
export const OutputsComparison: Story = {
    parameters: {
        agenta: {
            session: false,
            queries: (scope: StoryScope) => [
                revisionQuery(scope.projectId, APP_ID, {name: "classify", version: 3}),
                revisionQuery(scope.projectId, APP_B_ID, {name: "classify", version: 4}),
                revisionQuery(scope.projectId, EVAL_A_ID, {
                    name: "exact match",
                    isEvaluator: true,
                    outputs: {score: {type: "number"}, success: {type: "boolean"}},
                    feedbackConfig: SCORE_0_10,
                }),
            ],
            atoms: [
                [
                    playgroundNodesAtom,
                    [
                        node(APP_ID, 0, "classify v3"),
                        node(APP_B_ID, 0, "classify v4"),
                        node(EVAL_A_ID, 1, "exact match"),
                    ],
                ],
                [
                    resultsByKeyAtomFamily(loadableIdFor(APP_ID)),
                    {
                        [resultKey(ROW_ID, APP_ID)]: textResult(APP_ID, "refund_request"),
                        [resultKey(ROW_ID, APP_B_ID)]: textResult(APP_B_ID, "refund"),
                        [downstreamResultKey(ROW_ID, APP_ID, EVAL_A_ID)]: evaluatorResult(
                            `${APP_ID}:${EVAL_A_ID}`,
                            {score: 9, success: true},
                        ),
                        [downstreamResultKey(ROW_ID, APP_B_ID, EVAL_A_ID)]: evaluatorResult(
                            `${APP_B_ID}:${EVAL_A_ID}`,
                            {score: 4, success: false},
                        ),
                    },
                ],
            ],
        },
    },
    render: () => (
        <div className="max-w-[900px]">
            <PlaygroundOutputs rowId={ROW_ID} primaryEntityId={APP_ID} />
        </div>
    ),
}

/**
 * Nodes seeded, no results at all — the state before the first run. The primary card falls
 * back to `ClickRunPlaceholder` and each evaluator card renders its idle field grid, driven by
 * the output ports rather than by any result.
 */
export const OutputsIdle: Story = {
    parameters: {
        agenta: {
            session: false,
            queries: (scope: StoryScope) => [
                revisionQuery(scope.projectId, APP_ID, {name: "classify", version: 3}),
                revisionQuery(scope.projectId, EVAL_A_ID, {
                    name: "exact match",
                    isEvaluator: true,
                    outputs: {score: {type: "number"}, success: {type: "boolean"}},
                }),
            ],
            atoms: [
                [
                    playgroundNodesAtom,
                    [node(APP_ID, 0, "classify"), node(EVAL_A_ID, 1, "exact match")],
                ],
                [resultsByKeyAtomFamily(loadableIdFor(APP_ID)), {}],
            ],
        },
    },
    render: () => (
        <div className="max-w-[760px]">
            <PlaygroundOutputs rowId={ROW_ID} primaryEntityId={APP_ID} />
        </div>
    ),
}

// ---------------------------------------------------------------------------
// PlaygroundInputsBodyHost
// ---------------------------------------------------------------------------

/**
 * **Partial coverage — the empty-value case only. See the caveat at the end.**
 *
 * The host's one real dependency is
 * `executionItemController.selectors.inputsVisibility({testcaseId, downstreamKey})`
 * (`playgroundInputsAtomFamily`, execution/selectors.ts:504). Three things gate it, and each
 * one silently yields an empty split rather than an error:
 *
 *  1. `isChatModeAtom` must not be `undefined`. It resolves through
 *     `workflowMolecule.selectors.executionMode(rootNode.entityId)`, so it needs a depth-0
 *     node — `playgroundNodesAtom` below.
 *  2. `referencedVariableKeysAtomFamily` reads
 *     `loadableController.selectors.columns(loadableId)`, which delegates to the linked
 *     runnable's input ports *only when the loadable state names one*. Hence the
 *     `loadableStateAtomFamily` seed: `linkedRunnableType: "workflow"` +
 *     `linkedRunnableId: APP_ID` makes the columns come from the seeded revision's
 *     `data.schemas.inputs.properties`. `loadableStateAtomFamily` is a plain writable atom
 *     keyed per loadable id, so this is L1-isolated to this story.
 *  3. `testcaseMolecule.data(testcaseId)` supplies the VALUES. That one is the testcase
 *     molecule — `derivedLoadableIdAtom` → `displayRowIds`, the graph the wave-3 brief flags —
 *     and it is what `_fixtures/playgroundLoadable.ts` exists for. This story does not
 *     reimplement it: `newEntityIdsAtom` is a global singleton, so minting a local testcase
 *     here would leak rows into every other story that reads `displayRowIds`.
 *
 * **What this covers:** the referenced-variable cards render, with their names, type chips and
 * per-kind bodies driven by the port schema — i.e. the host's enrichment path
 * (`inputPortSchemaMap` → `expectedType` / `expectedSchema` / `helpText`) is exercised end to
 * end. **What it does not cover:** cards with values, the connected-source (database) indicator,
 * and the unreferenced-columns footer — all three come from the testcase entity. A follow-up
 * story on top of the loadable helper should add them; `VariableCard.stories.tsx` covers the
 * populated card bodies prop-first in the meantime.
 */
export const InputsBodyHost: Story = {
    parameters: {
        agenta: {
            session: false,
            queries: (scope: StoryScope) => [
                revisionQuery(scope.projectId, APP_ID, {
                    name: "classify",
                    version: 3,
                    inputs: {
                        question: {type: "string", title: "question"},
                        top_k: {type: "integer", title: "top_k"},
                        stream: {type: "boolean", title: "stream"},
                        filters: {type: "object", title: "filters"},
                    },
                }),
            ],
            atoms: [
                [playgroundNodesAtom, [node(APP_ID, 0, "classify")]],
                [resultsByKeyAtomFamily(loadableIdFor(APP_ID)), {}],
                [
                    loadableStateAtomFamily(loadableIdFor(APP_ID)),
                    linkedLoadableState(APP_ID, "classify"),
                ],
            ],
        },
    },
    render: () => (
        <div className="max-w-[720px]">
            <PlaygroundInputsBodyHost rowId={ROW_ID} downstreamKey="" editable />
        </div>
    ),
}

/** Same seed, read-only — `editable` also gates `unreferencedEditable`. */
export const InputsBodyHostReadOnly: Story = {
    parameters: {
        agenta: {
            session: false,
            queries: (scope: StoryScope) => [
                revisionQuery(scope.projectId, APP_ID, {
                    name: "classify",
                    version: 3,
                    inputs: {
                        question: {type: "string", title: "question"},
                        filters: {type: "object", title: "filters"},
                    },
                }),
            ],
            atoms: [
                [playgroundNodesAtom, [node(APP_ID, 0, "classify")]],
                [resultsByKeyAtomFamily(loadableIdFor(APP_ID)), {}],
                [
                    loadableStateAtomFamily(loadableIdFor(APP_ID)),
                    linkedLoadableState(APP_ID, "classify"),
                ],
            ],
        },
    },
    render: () => (
        <div className="max-w-[720px]">
            <PlaygroundInputsBodyHost rowId={ROW_ID} downstreamKey="" editable={false} />
        </div>
    ),
}

/**
 * `sections` partitions the same variables into named groups with a left-border accent — the
 * evaluator grouped layout. Variables not listed in any section fall into a trailing "other"
 * group, which is what `notes` demonstrates here.
 */
export const InputsBodyHostSections: Story = {
    parameters: {
        agenta: {
            session: false,
            queries: (scope: StoryScope) => [
                revisionQuery(scope.projectId, APP_ID, {
                    name: "judge",
                    version: 1,
                    inputs: {
                        question: {type: "string", title: "question"},
                        answer: {type: "string", title: "answer"},
                        rubric: {type: "string", title: "rubric"},
                        notes: {type: "string", title: "notes"},
                    },
                }),
            ],
            atoms: [
                [playgroundNodesAtom, [node(APP_ID, 0, "judge")]],
                [resultsByKeyAtomFamily(loadableIdFor(APP_ID)), {}],
                [
                    loadableStateAtomFamily(loadableIdFor(APP_ID)),
                    linkedLoadableState(APP_ID, "judge"),
                ],
            ],
        },
    },
    render: () => (
        <div className="max-w-[720px]">
            <PlaygroundInputsBodyHost
                rowId={ROW_ID}
                downstreamKey=""
                editable
                sections={[
                    {ariaLabel: "inputs", variableNames: ["question", "answer"]},
                    {ariaLabel: "grading", variableNames: ["rubric"]},
                ]}
            />
        </div>
    ),
}
