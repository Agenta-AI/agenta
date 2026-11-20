import type {ReactNode} from "react"

import {AutomationRunHistoryView} from "@agenta/automation-ui"
import {AgentOperationsSections} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {DAILY_SUMMARY, runHistoryQueries} from "../../../fixtures/builderLayout/automations"
import {
    phoneAutomationArgs,
    phoneAutomationQueries,
    phoneNoAutomationQueries,
} from "../../../fixtures/builderLayout/automations-phone"

/** A 390 x 844 phone screen whose one column scrolls, as the Automations tab mounts it. */
const Phone = ({children}: {children: ReactNode}) => (
    <div
        data-testid="phone-screen"
        className="ag-scroll-no-bar flex flex-col overflow-y-auto border border-solid border-border bg-colorBgContainer"
        style={{width: 390, height: 844}}
    >
        {children}
    </div>
)

/** The Automations tab on a phone (M10): phone rows and "Add automation" at the bottom. */
const PhoneAutomationsTab = ({revisionId, viewer}: {revisionId: string; viewer?: boolean}) => (
    <Phone>
        <AgentOperationsSections
            revisionId={revisionId}
            disabled={viewer}
            sticky={false}
            showFiles={false}
            automationDrawer={null}
            onOpenRunHistory={() => undefined}
            onOpenAutomation={() => undefined}
            onAddAutomation={() => undefined}
            phone
        />
    </Phone>
)

const meta = {
    title: "BuilderLayout/automations-phone/Automations tab",
    component: PhoneAutomationsTab,
    parameters: {
        layout: "fullscreen",
        agenta: {queries: phoneAutomationQueries, args: phoneAutomationArgs},
    },
    args: {revisionId: ""},
} satisfies Meta<typeof PhoneAutomationsTab>

export default meta
type Story = StoryObj<typeof meta>

/** M10: "Daily summary" and "New Zendesk ticket", each with its switch and "⋯". */
export const Tab: Story = {globals: {theme: "light"}}
export const TabDark: Story = {globals: {theme: "dark"}}

/** M11: the "Add automation" bottom sheet, opened from the full-width button. */
export const AddAutomationSheet: Story = {
    globals: {theme: "light"},
    play: async ({canvasElement}) => {
        const button = canvasElement.querySelector<HTMLButtonElement>(
            '[data-testid="phone-primary-action"] button',
        )
        button?.click()
    },
}
export const AddAutomationSheetDark: Story = {
    ...AddAutomationSheet,
    globals: {theme: "dark"},
}

/** A name longer than one row wraps; it is not cut. */
export const LongName: Story = {
    globals: {theme: "light"},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => phoneAutomationQueries(scope, {long: true}),
            args: phoneAutomationArgs,
        },
    },
}

/** No automation: the desktop empty state above "Add automation". */
export const Empty: Story = {
    globals: {theme: "light"},
    parameters: {agenta: {queries: phoneNoAutomationQueries, args: phoneAutomationArgs}},
}

/** A person who cannot edit: no switch and no "Add automation". */
export const Viewer: Story = {args: {viewer: true}, globals: {theme: "light"}}

/** The run history on a phone (53.2): one column, 44 px rows. */
const PhoneRunHistory = ({runId, empty}: {runId?: string; empty?: boolean}) => (
    <Phone>
        <AutomationRunHistoryView
            automation={DAILY_SUMMARY}
            frame="panel"
            phone
            initialRunId={runId}
            runHistoryHref="#full-run-history"
            sessionHref={(sessionId) => `#session-${sessionId}`}
            runNow={
                empty ? (
                    <button
                        type="button"
                        className="h-11 rounded-md border border-solid border-border bg-transparent px-3 text-sm"
                    >
                        Run now
                    </button>
                ) : null
            }
            renderConversation={() => (
                <p className="m-0 px-4 text-[13px] leading-relaxed">
                    Yesterday had 23 tickets: 9 billing, 8 bugs, 4 account, 2 other.
                </p>
            )}
        />
    </Phone>
)

export const RunHistoryList: Story = {
    globals: {theme: "light"},
    parameters: {agenta: {queries: (scope: StoryScope) => runHistoryQueries(scope)}},
    render: () => <PhoneRunHistory />,
}
export const RunHistoryRunOpen: Story = {
    globals: {theme: "light"},
    parameters: {agenta: {queries: (scope: StoryScope) => runHistoryQueries(scope)}},
    render: () => <PhoneRunHistory runId="delivery-1" />,
}
export const RunHistoryNoRuns: Story = {
    globals: {theme: "light"},
    parameters: {agenta: {queries: (scope: StoryScope) => runHistoryQueries(scope, [])}},
    render: () => <PhoneRunHistory empty />,
}
