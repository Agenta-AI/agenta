import {AutomationRunHistoryView} from "@agenta/automation-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    DAILY_SUMMARY,
    INSTRUCTION,
    runHistoryQueries,
} from "../../../fixtures/builderLayout/automations"

/** A stand-in for the app's chat surface: the instruction and the agent's answer, read only. */
const Transcript = ({sessionId}: {sessionId: string}) => (
    <div data-testid="run-transcript" data-session={sessionId} className="flex flex-col gap-3 p-4">
        <div className="self-end rounded-lg bg-muted px-3 py-2 text-[13px]">{INSTRUCTION}</div>
        <div className="text-[13px] leading-relaxed text-foreground">
            Yesterday had 23 tickets: 9 billing, 8 bugs, 4 account, 2 other. Three were high
            urgency, all about the double charge for March. I posted the digest to #ops.
        </div>
    </div>
)

/** The run history in a panel-wide container, as the right panel mounts it (F05 f6 to f9). */
const PanelRunHistory = ({
    width,
    runNow,
    runId,
}: {
    width: number
    runNow?: boolean
    runId?: string
}) => (
    <div
        data-testid="run-history-panel"
        className="ag-panel-raised flex h-[640px] flex-col border border-solid border-border"
        style={{width}}
    >
        <AutomationRunHistoryView
            automation={DAILY_SUMMARY}
            frame="panel"
            initialRunId={runId}
            runHistoryHref="#full-run-history"
            sessionHref={(sessionId) => `#session-${sessionId}`}
            runNow={
                runNow ? (
                    <button type="button" className="rounded-md border px-3 py-1 text-xs">
                        Run now
                    </button>
                ) : null
            }
            renderConversation={(sessionId) => <Transcript sessionId={sessionId} />}
        />
    </div>
)

const meta = {
    title: "BuilderLayout/automations/Run history",
    component: PanelRunHistory,
    parameters: {
        layout: "padded",
        agenta: {queries: (scope: StoryScope) => runHistoryQueries(scope)},
    },
} satisfies Meta<typeof PanelRunHistory>

export default meta
type Story = StoryObj<typeof meta>

/** F05 f6: the list in the 440px panel, one column. */
export const List: Story = {args: {width: 440}}

/** F05 f7: a run open in the 440px panel; it replaces the list. */
export const RunOpen: Story = {args: {width: 440, runId: "delivery-1"}}

/** F05 f8: the widened 760px panel, the list beside the newest run. */
export const WidePanel: Story = {args: {width: 760}}

/** F05 f9: no run yet, with "Run now". */
export const NoRuns: Story = {
    args: {width: 440, runNow: true},
    parameters: {agenta: {queries: (scope: StoryScope) => runHistoryQueries(scope, [])}},
}
