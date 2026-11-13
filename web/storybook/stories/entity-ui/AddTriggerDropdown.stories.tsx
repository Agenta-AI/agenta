import {AddTriggerDropdown} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {triggerSectionIds, triggerSectionQueries} from "../../fixtures/gatewayTrigger"

/**
 * The Triggers section header's "+ Trigger" affordance. Data-connected: `useAgentTriggers`
 * resolves the open agent so a trigger created here default-binds to it, so the story seeds
 * the same query cache the section does.
 *
 * The popover PANEL itself is `AddItemMenu`, covered by
 * `@agenta/entity-ui/Drawers/AddItemMenu`.
 */
const meta = {
    title: "@agenta/entity-ui/DrillIn/AddTriggerDropdown",
    component: AddTriggerDropdown,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A Radix Tooltip over a ghost icon `Button`. The tooltip and the AddItemMenu popover " +
                    "share one button by NESTING both `asChild` triggers (`PopoverTrigger` > " +
                    "`TooltipTrigger` > `Button`) — a Tooltip wrapped around the popover trigger " +
                    "would make PopoverTrigger's Slot clone the Tooltip instead of the button, and " +
                    "the popover would never open.",
            },
        },
    },
} satisfies Meta<typeof AddTriggerDropdown>

export default meta
type Story = StoryObj<typeof meta>

export const Variants: Story = {
    args: {entityId: null},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => triggerSectionQueries(scope),
            args: (scope: StoryScope) => ({entityId: triggerSectionIds(scope).revisionId}),
        },
    },
    render: (args) => (
        <div className="flex max-w-[900px] flex-col">
            <div className="grid grid-cols-[14rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
                <div className="text-xs text-colorTextSecondary">header "+" (default trigger)</div>
                <div className="flex items-center">
                    <AddTriggerDropdown {...args} />
                </div>
            </div>
        </div>
    ),
}
