import type {ReactNode} from "react"

import {
    PlaygroundInputsBody,
    UnreferencedColumnsFooter,
} from "@agenta/playground-ui/playground-inputs-body"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * The two containers around `VariableCard` (which has its own story).
 *
 * `PlaygroundInputsBody` is pure props — it owns the flat-vs-sectioned layout choice and the
 * draft-vs-normal write routing. `UnreferencedColumnsFooter` owns one piece of behaviour the
 * gates cannot see: it is **collapsed by default and re-mounts** whenever the unused-column set
 * changes, so a value that just migrated in never surfaces unsolicited. The `Expanded` story
 * below is the only way to see the revealed state, since a screenshot of the default is a
 * single button.
 */
const meta = {
    title: "@agenta/playground-ui/Inputs/BodyParts",
    parameters: {
        layout: "padded",
        // Prop-only components, but `VariableCard` sits under a session-gated query. Leaving the
        // gate open lets it fire and then abort on re-render, which surfaces as an uncaught
        // `AbortError` in the render-check. Nothing here needs server data, so close the gate.
        agenta: {session: false, queries: []},
        docs: {
            description: {
                component: "The inputs panel container and the unused-columns footer.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Case = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex flex-col gap-1">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[560px]">{children}</div>
    </div>
)

const INPUTS = [
    {name: "question", value: "Where is my refund?"},
    {name: "top_k", value: 3},
    {name: "filters", value: {tier: "pro", region: "eu"}},
]

const UNUSED = [
    {name: "legacy_id", value: "abc-123"},
    {name: "internal_note", value: "migrated 2026-04"},
]

export const Body: Story = {
    render: () => (
        <div className="flex flex-col gap-8">
            <Case label="flat list">
                <PlaygroundInputsBody rowId="row-1" inputs={INPUTS} editable onValueChange={noop} />
            </Case>
            <Case label="draft variable — no testcase column yet">
                <PlaygroundInputsBody
                    rowId="row-2"
                    inputs={[
                        {name: "geo", value: undefined, isDraft: true, expectedType: "object"},
                    ]}
                    editable
                    onValueChange={noop}
                    onAddDraftColumn={noop}
                />
            </Case>
            <Case label="sectioned — the evaluator envelope layout (left-border accent per group)">
                <PlaygroundInputsBody
                    rowId="row-3"
                    inputs={[]}
                    sections={[
                        {ariaLabel: "inputs", variables: [{name: "question", value: "Refund?"}]},
                        {
                            ariaLabel: "outputs",
                            variables: [{name: "answer", value: "Within 5 days."}],
                        },
                    ]}
                    editable
                    onValueChange={noop}
                />
            </Case>
            <Case label="synced from a testset — every card shows the source indicator">
                <PlaygroundInputsBody
                    rowId="row-4"
                    inputs={INPUTS.slice(0, 1)}
                    editable
                    onValueChange={noop}
                    connectedSourceName="Support triage"
                />
            </Case>
            <Case label="read-only, with the unused-columns footer attached">
                <PlaygroundInputsBody
                    rowId="row-5"
                    inputs={INPUTS.slice(0, 1)}
                    unreferencedColumns={UNUSED}
                    editable={false}
                    onValueChange={noop}
                />
            </Case>
        </div>
    ),
}

export const UnusedColumns: Story = {
    render: () => (
        <div className="flex flex-col gap-8">
            <Case label="collapsed (the default) — plural wording">
                <UnreferencedColumnsFooter rowId="row-1" columns={UNUSED} />
            </Case>
            <Case label="collapsed — singular wording">
                <UnreferencedColumnsFooter rowId="row-2" columns={UNUSED.slice(0, 1)} />
            </Case>
            <Case label="empty set renders nothing at all">
                <UnreferencedColumnsFooter rowId="row-3" columns={[]} />
            </Case>
        </div>
    ),
}

/** Clicks the toggle so the revealed read-only cards are visible in the screenshot. */
export const UnusedColumnsExpanded: Story = {
    render: () => (
        <div className="w-[560px]">
            <UnreferencedColumnsFooter rowId="row-1" columns={UNUSED} />
        </div>
    ),
    play: async ({canvasElement}) => {
        const toggle = canvasElement.querySelector<HTMLButtonElement>(
            '.agenta-unreferenced-footer button[aria-expanded="false"]',
        )
        toggle?.click()
    },
}
