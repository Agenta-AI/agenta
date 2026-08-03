import {TriggerManagementSection} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {
    triggerSchedule,
    triggerSectionIds,
    triggerSectionQueries,
    triggerSubscription,
} from "../../fixtures/gatewayTrigger"

/**
 * **Data-connected section story.** `TriggerManagementSection` is atom-driven end to end:
 * it resolves the open agent from the workflow molecule (`useAgentTriggers`), filters the
 * project-wide subscription/schedule lists down to that agent's `data.references`, and
 * decorates app subscriptions with the connections + catalog-integrations caches.
 *
 * Nothing is mocked — the stories seed the same two injection points the app uses: the
 * query cache (six keys, listed in `fixtures/gatewayTrigger.ts` next to the atoms that own
 * them) and the `projectIdAtom`/`sessionAtom` gates. Entity ids are story-scoped, so two
 * stories cannot address the same `atomFamily(id)` entry.
 *
 * antd → `@agenta/ui`: the header "+" is a Radix Tooltip over a ghost icon `Button`, and
 * each row's "⋯" menu is a `DropdownMenu` built from composed `DropdownMenuItem` JSX
 * (the `MenuProps["items"]` arrays this section used to build are gone, along with the
 * antd type leak they carried into `TriggerRow` / `SubscriptionChildRow`).
 */
const meta = {
    title: "@agenta/entity-ui/DrillIn/TriggerManagementSection",
    component: TriggerManagementSection,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The agent config panel's Triggers region: a Subscriptions accordion (app " +
                    "triggers grouped by provider) and a Schedules accordion (cron rows), both " +
                    "scoped to the open agent.",
            },
        },
    },
} satisfies Meta<typeof TriggerManagementSection>

export default meta
type Story = StoryObj<typeof meta>

const populated = (scope: StoryScope) => {
    const ids = triggerSectionIds(scope)
    return triggerSectionQueries(scope, {
        subscriptions: [
            triggerSubscription(ids, {
                id: scope.id("sub-1"),
                name: "Ops escalations",
                eventKey: "SLACK_MESSAGE_REACTION_ADDED",
            }),
            triggerSubscription(ids, {
                id: scope.id("sub-2"),
                eventKey: "SLACK_NEW_MESSAGE",
                active: false,
            }),
        ],
        schedules: [
            triggerSchedule(ids, {
                id: scope.id("sch-1"),
                name: "Morning digest",
                cron: "0 9 * * *",
                message: "Summarize yesterday's tickets.",
            }),
            triggerSchedule(ids, {
                id: scope.id("sch-2"),
                cron: "0 8 * * 1",
                active: false,
            }),
        ],
    })
}

const withEntityId = (scope: StoryScope) => ({entityId: triggerSectionIds(scope).revisionId})

// Showcase (no antd half), so there is no `.grid` parity layout. `data-vrt-subject` is the
// harness's readiness marker: without it the a11y run has nothing visible to wait for and
// times out before axe ever sees the section. The VRT ignores it outside a `.grid` row.
const Frame = (children: React.ReactNode) => (
    <div data-vrt-subject className="w-[420px]">
        {children}
    </div>
)

/** Both accordions populated: a Slack provider group with two subscriptions + two schedules. */
export const WithTriggers: Story = {
    args: {entityId: null},
    parameters: {agenta: {queries: populated, args: withEntityId}},
    render: (args) => Frame(<TriggerManagementSection {...args} />),
}

/** Read-only revision — no header "+", no empty-state links, rows open nothing. */
export const ReadOnly: Story = {
    args: {entityId: null, disabled: true},
    parameters: {agenta: {queries: populated, args: withEntityId}},
    render: (args) => Frame(<TriggerManagementSection {...args} />),
}

/** No triggers bound to this agent: both accordions render their add-a-trigger text links. */
export const Empty: Story = {
    args: {entityId: null},
    parameters: {
        agenta: {queries: (scope: StoryScope) => triggerSectionQueries(scope), args: withEntityId},
    },
    render: (args) => Frame(<TriggerManagementSection {...args} />),
}
