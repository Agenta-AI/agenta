import type {ReactNode} from "react"

import {GatewayToolAssistantActions, GatewayToolExecuteButton} from "@agenta/playground-ui"
import {GenerationComparisonInputHeader} from "@agenta/playground-ui/comparison-view"
import {
    ExecutionRowActions,
    ExecutionRowRunControl,
    RunOptionsPopover,
} from "@agenta/playground-ui/execution-row"
import {Button} from "@agenta/ui/ui"
import {DotsThree} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * The execution-row leaves: run control, run-options popover, per-row actions, the gateway tool
 * buttons, and the comparison input header.
 *
 * Two of these have a **silent empty branch** and are the reason each gets an explicit
 * populated story:
 *
 * - `GatewayToolExecuteButton` filters its payloads through `isGatewayToolSlug`, which only
 *   accepts the exact `tools__{provider}__{integration}__{action}__{connection}` shape. A tool
 *   named anything else yields `null` — a green page with nothing on it.
 * - `GatewayToolAssistantActions` returns `null` when the assistant result carries no
 *   `tool_calls`. That is exactly how `ToolCallView` passed both gates on an empty page in
 *   chunk 1.
 *
 * `RunOptionsPopover` and `ExecutionRowActions` read playground atoms, but both degrade
 * honestly without a seeded row graph: the popover's repeat count comes from
 * `repetitionCountAtom` (a plain writable singleton), and the actions' delete button disables
 * itself when there is one row or fewer. The seeded-graph versions live with `ExecutionRow`.
 */
const meta = {
    title: "@agenta/playground-ui/Execution/Leaves",
    parameters: {
        layout: "padded",
        agenta: {session: false, queries: []},
        docs: {
            description: {
                component: "Run controls, row actions, gateway tool buttons, comparison header.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Case = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex flex-col gap-2 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-start gap-3">{children}</div>
    </div>
)

const STEP_OPTIONS = [
    {key: "classify", label: "Run classify"},
    {key: "summarise", label: "Run summarise"},
]

/** The `tools__` slug shape is load-bearing — see the file header. */
const GATEWAY_TOOL = "tools__composio__gmail__CREATE_EMAIL_DRAFT__default"

const toolPayload = (name: string) => ({
    name,
    callId: `call_${name}`,
    json: JSON.stringify({to: "support@example.com", subject: "Refund"}, null, 2),
})

export const RunControl: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Case label="single step — plain RunButton">
                <ExecutionRowRunControl
                    showDropdown={false}
                    stepOptions={[]}
                    isBusy={false}
                    onRun={noop}
                    onCancel={noop}
                    onOptionSelect={noop}
                />
            </Case>
            <Case label="busy — the run button flips to Cancel">
                <ExecutionRowRunControl
                    showDropdown={false}
                    stepOptions={[]}
                    isBusy
                    onRun={noop}
                    onCancel={noop}
                    onOptionSelect={noop}
                />
            </Case>
            <Case label="already running, dropdown off — disabled">
                <ExecutionRowRunControl
                    showDropdown={false}
                    stepOptions={[]}
                    isBusy={false}
                    isRunning
                    onRun={noop}
                    onCancel={noop}
                    onOptionSelect={noop}
                />
            </Case>
            <Case label="multi-step — DropdownButton with per-step options">
                <ExecutionRowRunControl
                    showDropdown
                    stepOptions={STEP_OPTIONS}
                    isBusy={false}
                    onRun={noop}
                    onCancel={noop}
                    onOptionSelect={noop}
                />
            </Case>
            <Case label="multi-step, busy on a named step">
                <ExecutionRowRunControl
                    showDropdown
                    stepOptions={STEP_OPTIONS}
                    isBusy
                    runningStepLabel="classify"
                    onRun={noop}
                    onCancel={noop}
                    onOptionSelect={noop}
                />
            </Case>
            <Case label="multi-step, busy with no step name">
                <ExecutionRowRunControl
                    showDropdown
                    stepOptions={STEP_OPTIONS}
                    isBusy
                    onRun={noop}
                    onCancel={noop}
                    onOptionSelect={noop}
                />
            </Case>
            <Case label="showDropdown with NO options — falls back to the plain button">
                <ExecutionRowRunControl
                    showDropdown
                    stepOptions={[]}
                    isBusy={false}
                    onRun={noop}
                    onCancel={noop}
                    onOptionSelect={noop}
                />
            </Case>
        </div>
    ),
}

/** The popover trigger; the panel itself opens on click (see `RunOptionsOpen`). */
export const RunOptions: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Case label="idle">
                <RunOptionsPopover isRunning={false} entityId="entity-1" />
            </Case>
            <Case label="running — trigger disabled">
                <RunOptionsPopover isRunning entityId="entity-1" />
            </Case>
        </div>
    ),
}

/** Opened, so the repeats InputNumber + Slider are actually in the picture. */
export const RunOptionsOpen: Story = {
    render: () => (
        <div className="flex h-[320px] max-w-[760px] flex-col p-4">
            <RunOptionsPopover isRunning={false} entityId="entity-1" />
        </div>
    ),
    play: async ({canvasElement}) => {
        canvasElement.querySelector<HTMLButtonElement>('button[aria-label="Run options"]')?.click()
    },
}

/**
 * Row actions. With no seeded row graph `executionRowIds` is empty, so delete is disabled —
 * that is the component's real one-row-left behaviour, not a fixture gap.
 */
export const RowActions: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Case label="single view, no menu slot">
                <ExecutionRowActions rowId="row-1" />
            </Case>
            <Case label="single view with a menu slot supplied by the caller">
                <ExecutionRowActions
                    rowId="row-1"
                    renderMenu={() => (
                        <Button variant="ghost" size="icon-sm" aria-label="More">
                            <DotsThree size={14} />
                        </Button>
                    )}
                />
            </Case>
        </div>
    ),
}

export const GatewayTools: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Case label="one gateway tool call">
                <GatewayToolExecuteButton
                    toolPayloads={[toolPayload(GATEWAY_TOOL)]}
                    onUpdateToolResponse={noop}
                    onExecuteToolCall={async () => ({
                        call: {data: {content: '{"ok":true}', role: "tool"}},
                    })}
                />
            </Case>
            <Case label="two gateway tool calls">
                <GatewayToolExecuteButton
                    toolPayloads={[
                        toolPayload(GATEWAY_TOOL),
                        toolPayload("tools__composio__slack__SEND_MESSAGE__default"),
                    ]}
                    onUpdateToolResponse={noop}
                    onExecuteToolCall={async () => ({call: {data: {content: "sent"}}})}
                />
            </Case>
            <Case label="non-gateway tool name — renders NOTHING, by design">
                <GatewayToolExecuteButton
                    toolPayloads={[toolPayload("get_weather")]}
                    onUpdateToolResponse={noop}
                    onExecuteToolCall={async () => ({call: {data: {content: "{}"}}})}
                />
            </Case>
            <Case label="assistant actions — result carries a gateway tool_call">
                <GatewayToolAssistantActions
                    rowId="row-1"
                    entityId="entity-1"
                    currentResult={{
                        data: {
                            tool_calls: [
                                {
                                    id: "call_1",
                                    type: "function",
                                    function: {
                                        name: GATEWAY_TOOL,
                                        arguments: '{"to":"support@example.com"}',
                                    },
                                },
                            ],
                        },
                    }}
                    onRun={noop}
                    onExecuteToolCall={async () => ({call: {data: {content: "drafted"}}})}
                />
            </Case>
            <Case label="assistant actions — no tool_calls, renders NOTHING, by design">
                <GatewayToolAssistantActions
                    rowId="row-2"
                    entityId="entity-1"
                    currentResult={{data: {content: "Refunds take 5 days."}}}
                    onRun={noop}
                    onExecuteToolCall={async () => ({call: {data: {content: "{}"}}})}
                />
            </Case>
        </div>
    ),
}

/** 44px-tall column header above the comparison grid's input column. */
export const ComparisonInputHeader: Story = {
    render: () => (
        <div className="w-[420px]">
            <GenerationComparisonInputHeader />
        </div>
    ),
}
