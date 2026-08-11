import React from "react"

import ExecutionItems from "@agenta/playground-ui/execution-items"
import {
    ChatTurnView,
    ComparisonLayout,
    ExecutionRow,
    SingleLayout,
} from "@agenta/playground-ui/execution-row"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    StoryPlaygroundUIProvider,
    entityIds,
    seedPlaygroundLoadable,
    turnIdFor,
    useSeededRowIds,
} from "./_fixtures/playgroundLoadable"

/**
 * The composite execution surfaces — the panel, the row, and the three layouts the row
 * delegates to. These are **showcases**, not parity rows: the antd → @agenta/ui migration in
 * this tree is already merged and verified, so there is no pre-migration half to diff against.
 * What they gate instead is that these components render at all, which nothing else checks —
 * every one of them is blank without a seeded execution graph, and a blank story passes both
 * the VRT and axe.
 *
 * ## Covered
 *
 * - `ExecutionItems` — the whole panel, in both completion and chat mode.
 * - `ExecutionRow` — the router: single vs comparison, chosen from the loadable's session count.
 * - `SingleLayout` — the 1084-LOC outlier, across idle / success / error / running.
 * - `ComparisonLayout` — the two-variant grid.
 * - `ChatTurnView` — one turn, answered and unanswered.
 *
 * ## Not covered
 *
 * - The **agent arm** of `ExecutionItems`. It renders `providers.AgentGenerationPanel`, which
 *   lives in `web/oss` and cannot be imported from a package story; with the slot absent the
 *   arm is a documented no-op, so there is nothing to show.
 * - Chain / downstream-node rows (`DownstreamNodeCard`, `StepCollapsedSummary`). Those need a
 *   depth>0 evaluator node wired through `addDownstreamNode` and a second results namespace —
 *   a separate seed, not a variation on this one.
 * - Repetitions beyond count 1. `useRepetitionResult` needs a `repetitions[]` array on the
 *   RunResult, which the seed does not build.
 *
 * Every story here seeds through `_fixtures/playgroundLoadable`; read that file first — it
 * explains why a node has to exist before any row does.
 */
const meta = {
    title: "@agenta/playground-ui/Execution/Composites",
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Execution panel, row router, and the single / comparison / chat layouts, on a seeded loadable.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const Frame = ({children}: {children: React.ReactNode}) => (
    <div className="w-full bg-colorBgContainer">
        <StoryPlaygroundUIProvider>{children}</StoryPlaygroundUIProvider>
    </div>
)

/** Row ids are minted by the seed, so the story reads them back instead of hard-coding them. */
const WithFirstRow = ({children}: {children: (rowId: string) => React.ReactNode}) => {
    const rowIds = useSeededRowIds()
    if (!rowIds[0]) return <div className="p-4 text-colorError">no seeded rows</div>
    return <>{children(rowIds[0])}</>
}

const noop = () => undefined

// Each story owns its entity ids: the loadable, the testcase store and the chat store are all
// global, so two stories sharing an id would share rows.
const [ITEMS_COMPLETION] = entityIds("items-completion")
const [ITEMS_CHAT] = entityIds("items-chat")
const [ROW_SINGLE] = entityIds("row-single")
const ROW_COMPARE = entityIds("row-compare", 2)
const [LAYOUT_IDLE] = entityIds("layout-idle")
const [LAYOUT_SUCCESS] = entityIds("layout-success")
const [LAYOUT_ERROR] = entityIds("layout-error")
const [LAYOUT_RUNNING] = entityIds("layout-running")
const COMPARE_LAYOUT = entityIds("compare-layout", 2)
const [TURN_ANSWERED] = entityIds("turn-answered")
const [TURN_PENDING] = entityIds("turn-pending")

const SUPPORT_ROWS = [
    {ticket: "Where is my refund? I cancelled two weeks ago."},
    {ticket: "The API returns 401 after I rotated my key."},
]

// ---------------------------------------------------------------------------
// ExecutionItems — the whole panel
// ---------------------------------------------------------------------------

/** Completion mode: header, one card per test case, one of them already run. */
export const ExecutionItemsCompletion: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [{id: ITEMS_COMPLETION, label: "classify", variables: ["ticket"]}],
            rows: SUPPORT_ROWS,
            results: [{row: 0, entity: ITEMS_COMPLETION, output: "billing", traceId: "tr-9f21"}],
        }),
    },
    render: () => (
        <Frame>
            <ExecutionItems entityId={ITEMS_COMPLETION} />
        </Frame>
    ),
}

/**
 * Chat mode. `chat: true` puts `is_chat` on the revision, which is what flips
 * `isChatModeAtom` — the panel then reads turns from the chat store instead of test cases.
 */
export const ExecutionItemsChat: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [
                {
                    id: ITEMS_CHAT,
                    label: "support-bot",
                    chat: true,
                    promptMessages: [{role: "system", content: "You are a support agent."}],
                },
            ],
            turns: [
                {
                    user: "My invoice shows two charges for March.",
                    replies: {[ITEMS_CHAT]: "I see a duplicate charge — I've refunded it."},
                },
                {user: "How long until it lands?"},
            ],
        }),
    },
    render: () => (
        <Frame>
            <ExecutionItems entityId={ITEMS_CHAT} />
        </Frame>
    ),
}

// ---------------------------------------------------------------------------
// ExecutionRow — the router
// ---------------------------------------------------------------------------

/** One entity in the playground, so the row routes to `SingleLayout`. */
export const ExecutionRowSingle: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [{id: ROW_SINGLE, label: "classify", variables: ["ticket"]}],
            rows: [SUPPORT_ROWS[0]],
            results: [{row: 0, entity: ROW_SINGLE, output: "billing"}],
        }),
    },
    render: () => (
        <Frame>
            <WithFirstRow>
                {(rowId) => <ExecutionRow entityId={ROW_SINGLE} rowId={rowId} index={0} />}
            </WithFirstRow>
        </Frame>
    ),
}

/**
 * Two entities, so `isCompareModeWithContext` is true and the same component routes to
 * `ComparisonLayout` instead — the branch is data-driven, not a prop.
 */
export const ExecutionRowComparison: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [
                {id: ROW_COMPARE[0], label: "classify v1", variables: ["ticket"]},
                {id: ROW_COMPARE[1], label: "classify v2", variables: ["ticket"]},
            ],
            rows: [SUPPORT_ROWS[0]],
            results: [
                {row: 0, entity: ROW_COMPARE[0], output: "billing"},
                {row: 0, entity: ROW_COMPARE[1], output: "billing / refund"},
            ],
        }),
    },
    render: () => (
        <Frame>
            <WithFirstRow>
                {(rowId) => <ExecutionRow entityId={ROW_COMPARE[0]} rowId={rowId} index={0} />}
            </WithFirstRow>
        </Frame>
    ),
}

// ---------------------------------------------------------------------------
// SingleLayout — result state comes from props, the graph only supplies the row
// ---------------------------------------------------------------------------

const singleLayoutArgs = {
    isChat: false,
    isBusy: false,
    isRunning: false,
    resultHash: null,
    runRow: noop,
    cancelRow: noop,
    containerClassName: "border-0 border-b border-solid border-colorBorderSecondary",
}

/** Never run: the output card shows the click-to-run placeholder. */
export const SingleLayoutIdle: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [{id: LAYOUT_IDLE, label: "classify", variables: ["ticket"]}],
            rows: [SUPPORT_ROWS[0]],
        }),
    },
    render: () => (
        <Frame>
            <WithFirstRow>
                {(rowId) => (
                    <SingleLayout
                        {...singleLayoutArgs}
                        rowId={rowId}
                        entityId={LAYOUT_IDLE}
                        result={undefined}
                        index={0}
                    />
                )}
            </WithFirstRow>
        </Frame>
    ),
}

/** A completed run, with the trace slot filled by the injected provider. */
export const SingleLayoutSuccess: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [{id: LAYOUT_SUCCESS, label: "classify", variables: ["ticket"]}],
            rows: [SUPPORT_ROWS[0]],
        }),
    },
    render: () => (
        <Frame>
            <WithFirstRow>
                {(rowId) => (
                    <SingleLayout
                        {...singleLayoutArgs}
                        rowId={rowId}
                        entityId={LAYOUT_SUCCESS}
                        status="success"
                        result={{response: {data: "billing"}}}
                        displayResult={{response: {data: "billing"}}}
                        resultHash="hash-1"
                        traceId="tr-9f21"
                        index={0}
                    />
                )}
            </WithFirstRow>
        </Frame>
    ),
}

/** `status: "error"` replaces the result with the message, regardless of `result`. */
export const SingleLayoutError: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [{id: LAYOUT_ERROR, label: "classify", variables: ["ticket"]}],
            rows: [SUPPORT_ROWS[0]],
        }),
    },
    render: () => (
        <Frame>
            <WithFirstRow>
                {(rowId) => (
                    <SingleLayout
                        {...singleLayoutArgs}
                        rowId={rowId}
                        entityId={LAYOUT_ERROR}
                        status="error"
                        errorMessage="Rate limited by the provider. Retry in 30s."
                        result={undefined}
                        index={0}
                    />
                )}
            </WithFirstRow>
        </Frame>
    ),
}

/**
 * Busy. The output card follows the `isBusy` PROP, but the run control follows
 * `chainStatus.isBusy` read from the store — so the run must be seeded as well, or the story
 * shows a typing indicator next to an enabled Run button.
 */
export const SingleLayoutRunning: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [{id: LAYOUT_RUNNING, label: "classify", variables: ["ticket"]}],
            rows: [SUPPORT_ROWS[0]],
            results: [{row: 0, entity: LAYOUT_RUNNING, running: true}],
        }),
    },
    render: () => (
        <Frame>
            <WithFirstRow>
                {(rowId) => (
                    <SingleLayout
                        {...singleLayoutArgs}
                        rowId={rowId}
                        entityId={LAYOUT_RUNNING}
                        isBusy
                        isRunning
                        status="running"
                        result={undefined}
                        index={0}
                    />
                )}
            </WithFirstRow>
        </Frame>
    ),
}

// ---------------------------------------------------------------------------
// ComparisonLayout
// ---------------------------------------------------------------------------

/** Rendered directly rather than through the row, so the grid is the subject. */
export const ComparisonLayoutTwoVariants: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [
                {id: COMPARE_LAYOUT[0], label: "classify v1", variables: ["ticket"]},
                {id: COMPARE_LAYOUT[1], label: "classify v2", variables: ["ticket"]},
            ],
            rows: [SUPPORT_ROWS[0]],
            results: [
                {row: 0, entity: COMPARE_LAYOUT[0], output: "billing", traceId: "tr-a1"},
                {row: 0, entity: COMPARE_LAYOUT[1], error: "Timed out after 30s"},
            ],
        }),
    },
    render: () => (
        <Frame>
            <WithFirstRow>
                {(rowId) => (
                    <ComparisonLayout
                        rowId={rowId}
                        entityId={COMPARE_LAYOUT[0]}
                        isChat={false}
                        viewType="comparison"
                        resultHash={null}
                        runRow={noop}
                        cancelRow={noop}
                        isBusy={false}
                    />
                )}
            </WithFirstRow>
        </Frame>
    ),
}

// ---------------------------------------------------------------------------
// ChatTurnView
// ---------------------------------------------------------------------------

/**
 * One answered turn. `turnId` is the USER message's id — assistant replies hang off it by
 * `parentId`, scoped to `sess:{entityId}`, which is how one turn shows a different answer per
 * variant in comparison mode.
 */
export const ChatTurnAnswered: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [{id: TURN_ANSWERED, label: "support-bot", chat: true}],
            turns: [
                {
                    user: "My invoice shows two charges for March.",
                    replies: {
                        [TURN_ANSWERED]:
                            "I found a duplicate charge of $49 on 3 March and refunded it.",
                    },
                },
            ],
        }),
    },
    render: () => (
        <Frame>
            <div className="p-4">
                <ChatTurnView
                    turnId={turnIdFor(TURN_ANSWERED, 0)}
                    entityId={TURN_ANSWERED}
                    withControls
                    isLastTurn
                />
            </div>
        </Frame>
    ),
}

/** No reply yet on the last turn — the "no output" placeholder branch. */
export const ChatTurnAwaitingRun: Story = {
    parameters: {
        agenta: seedPlaygroundLoadable({
            entities: [{id: TURN_PENDING, label: "support-bot", chat: true}],
            turns: [{user: "Can you resend the receipt?"}],
        }),
    },
    render: () => (
        <Frame>
            <div className="p-4">
                <ChatTurnView
                    turnId={turnIdFor(TURN_PENDING, 0)}
                    entityId={TURN_PENDING}
                    withControls
                    isLastTurn
                />
            </div>
        </Frame>
    ),
}
