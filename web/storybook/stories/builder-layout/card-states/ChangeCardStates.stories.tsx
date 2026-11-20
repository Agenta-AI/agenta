import {ApprovalCard, ChangeResultRows} from "@agenta/chat/components"
import type {PendingApproval} from "@agenta/chat/model"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {AgentaDataParameters} from "../../../.storybook/decorators/withAgentaData"
import {conflictQueries} from "../../../fixtures/builderLayout/card-data"
import {
    CLOSE_TICKET,
    GROUPED_CALLS,
    OWN_COMMIT,
    RESULT_PARTS,
    TWO_CALLS_ONE_BASE,
} from "../../../fixtures/builderLayout/card-states"

/**
 * Change card states and results (task 26): the five result rows of canvas C01, the grouped card
 * of several calls, the answered and read-only cards, and the same card in an agent's own chat.
 */
const noop = () => undefined
const ACTIONS = {onView: noop, onRevert: noop, onTryAgain: noop}

const Demo = ({
    approvals,
    parts,
    answered,
    readOnly,
}: {
    approvals?: PendingApproval[]
    parts?: unknown[][]
    answered?: boolean
    readOnly?: boolean
}) => (
    <div data-testid="change-card" className="flex w-[440px] flex-col gap-3 bg-background p-4">
        {approvals ? (
            <ApprovalCard
                approvals={approvals}
                answered={answered}
                readOnly={readOnly}
                onRespond={noop}
                onApproveAll={noop}
                onDenyAll={noop}
            />
        ) : null}
        {parts?.map((one, index) => (
            <ChangeResultRows key={index} parts={one} actions={ACTIONS} />
        ))}
    </div>
)

const meta = {
    title: "BuilderLayout/card-states/Change card states",
    component: Demo,
    parameters: {layout: "centered"},
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

/** The five result rows: waiting, saved, denied, conflict, and the read-only line. */
export const ResultRows: Story = {
    args: {
        parts: [
            [
                ...RESULT_PARTS.waiting,
                ...RESULT_PARTS.saved,
                ...RESULT_PARTS.denied,
                ...RESULT_PARTS.conflict,
                ...RESULT_PARTS.accessDenied,
            ],
        ],
        approvals: [GROUPED_CALLS[2]],
        readOnly: true,
    },
}

export const GroupedCard: Story = {args: {approvals: GROUPED_CALLS}}

/** A newer version landed after the builder read v4: each group shows the conflict. */
export const GroupedConflict: Story = {
    args: {approvals: GROUPED_CALLS},
    parameters: {
        agenta: {
            queries: (scope) => conflictQueries(scope.projectId),
        } satisfies AgentaDataParameters,
    },
}

export const TwoCallsOneBase: Story = {args: {parts: [TWO_CALLS_ONE_BASE]}}

export const Answered: Story = {args: {approvals: [GROUPED_CALLS[2]], answered: true}}

export const ReadOnly: Story = {args: {approvals: [GROUPED_CALLS[0]], readOnly: true}}

/** The agent's own chat: the same card for its own commit, and a tool call with no version. */
export const AgentOwnChat: Story = {args: {approvals: [OWN_COMMIT]}}
export const AgentToolCall: Story = {args: {approvals: [CLOSE_TICKET]}}
