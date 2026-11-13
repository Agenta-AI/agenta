import {AddItemMenu, type AddItemGroup} from "@agenta/entity-ui/drawers/shared"
import {Calendar, Lightning, Wrench} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// AddItemMenu — the shared "+ add" popover for config sections. The closed default trigger is
// shown in Variants; the open panel is interactive — click the trigger in Playground.
const meta = {
    title: "@agenta/entity-ui/Drawers/AddItemMenu",
    component: AddItemMenu,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Grouped add-menu (icon, title, subtitle, chevron for drawer-opening rows) in a popover. The default `+` trigger is a ghost icon button.",
            },
        },
    },
} satisfies Meta<typeof AddItemMenu>

export default meta
type Story = StoryObj<typeof meta>

const groups: AddItemGroup[] = [
    {
        label: "Platform",
        items: [
            {
                key: "schedule",
                icon: <Calendar size={16} />,
                title: "Schedule",
                subtitle: "Run on a cron cadence",
                opensDrawer: true,
            },
            {
                key: "tool",
                icon: <Wrench size={16} />,
                title: "Custom tool",
                subtitle: "Reference another workflow",
                opensDrawer: true,
            },
        ],
    },
    {
        label: "Third-party",
        items: [
            {
                key: "composio",
                icon: <Lightning size={16} />,
                title: "Integration event",
                subtitle: "GitHub, Slack, …",
                opensDrawer: true,
            },
            {
                key: "soon",
                icon: <Lightning size={16} />,
                title: "Webhooks",
                disabled: true,
                disabledHint: "Coming soon",
            },
        ],
    },
]

// The closed trigger is the only resting-state surface (a closed AddItemMenu renders exactly
// its trigger).
export const Variants: Story = {
    args: {groups},
    render: () => (
        <div className="flex max-w-[700px] flex-col">
            <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
                <div className="text-xs text-colorTextSecondary">trigger (closed)</div>
                <span className="inline-flex">
                    <AddItemMenu groups={groups} />
                </span>
            </div>
            <div className="grid grid-cols-[10rem_1fr] items-start gap-4 py-3">
                <div className="text-xs text-colorTextSecondary">trigger · disabled</div>
                <span className="inline-flex">
                    <AddItemMenu groups={groups} disabled />
                </span>
            </div>
        </div>
    ),
}

// Interactive showcase — click the `+` to open the grouped panel (with a disabled row + tooltip).
export const Playground: Story = {
    args: {groups},
}
