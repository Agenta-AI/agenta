import type {ReactNode} from "react"

import {AddTriggerDropdown} from "@agenta/entity-ui/drill-in"
import {Plus} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Tooltip as AntTooltip} from "antd"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {triggerSectionIds, triggerSectionQueries} from "../../fixtures/gatewayTrigger"

/**
 * The Triggers section header's "+ Trigger" affordance. Data-connected: `useAgentTriggers`
 * resolves the open agent so a trigger created here default-binds to it, so the story seeds
 * the same query cache the section does.
 *
 * The antd cell replays the PRE-migration trigger verbatim from feat/storybook-data-seam
 * (`<Tooltip title="Add trigger"><Button type="text" icon={<Plus size={16}/>}/></Tooltip>`);
 * the agenta cell renders the migrated component. The popover PANEL itself is `AddItemMenu`,
 * covered by `@agenta/entity-ui/Drawers/AddItemMenu`.
 */
const meta = {
    title: "@agenta/entity-ui/DrillIn/AddTriggerDropdown",
    component: AddTriggerDropdown,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'antd `Tooltip` + `Button type="text" icon` → a Radix Tooltip over `@agenta/ui` ' +
                    '`Button variant="ghost" size="icon"`. The tooltip and the AddItemMenu popover ' +
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

const Row = ({label, a, s}: {label: string; a: ReactNode; s: ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">antd</span>
            <div className="flex items-center" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">agenta</span>
            <div className="flex items-center" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {entityId: null},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => triggerSectionQueries(scope),
            args: (scope: StoryScope) => ({entityId: triggerSectionIds(scope).revisionId}),
        },
    },
    render: (args) => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label='header "+" (default trigger)'
                a={
                    <AntTooltip title="Add trigger">
                        <AntButton type="text" icon={<Plus size={16} />} aria-label="Add trigger" />
                    </AntTooltip>
                }
                s={<AddTriggerDropdown {...args} />}
            />
        </div>
    ),
}
