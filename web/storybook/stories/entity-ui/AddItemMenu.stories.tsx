import {AddItemMenu, type AddItemGroup} from "@agenta/entity-ui/drawers/shared"
import {Calendar, Lightning, Plus, Wrench} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton} from "antd"

// AddItemMenu — the shared "+ add" popover for config sections. antd `Dropdown popupRender`
// → `@agenta/ui` Popover (the panel chrome moved onto PopoverContent; the antd Dropdown
// wrapper was chrome-less). The closed default trigger (antd text icon Button → ghost icon
// Button) is the VRT pair; the open panel is interactive — click the trigger in Playground.
const meta = {
    title: "@agenta/entity-ui/Drawers/AddItemMenu",
    component: AddItemMenu,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Grouped add-menu (icon, title, subtitle, chevron for drawer-opening rows). antd `Dropdown` with a custom `popupRender` panel → controlled `@agenta/ui` Popover carrying the same panel chrome; the default `+` trigger maps antd text/icon Button → ghost `size="icon"` Button.',
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

// The closed trigger is the only resting-state surface — antd's text icon Button vs the
// migrated default trigger (a closed AddItemMenu renders exactly its trigger).
export const AntdVsAgenta: Story = {
    args: {groups},
    render: () => (
        <div className="flex max-w-[700px] flex-col">
            <div className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
                <div className="text-xs text-colorTextSecondary">trigger (closed)</div>
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-colorTextSecondary">antd</span>
                    <span className="inline-flex" data-vrt-subject>
                        <AntButton type="text" icon={<Plus size={16} />} aria-label="Add" />
                    </span>
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-colorTextSecondary">agenta</span>
                    <span className="inline-flex" data-vrt-subject>
                        <AddItemMenu groups={groups} />
                    </span>
                </div>
            </div>
            <div className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 py-3">
                <div className="text-xs text-colorTextSecondary">trigger · disabled</div>
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-colorTextSecondary">antd</span>
                    <span className="inline-flex" data-vrt-subject>
                        <AntButton
                            type="text"
                            icon={<Plus size={16} />}
                            aria-label="Add"
                            disabled
                        />
                    </span>
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-colorTextSecondary">agenta</span>
                    <span className="inline-flex" data-vrt-subject>
                        <AddItemMenu groups={groups} disabled />
                    </span>
                </div>
            </div>
        </div>
    ),
}

// Interactive showcase — click the `+` to open the grouped panel (with a disabled row + tooltip).
export const Playground: Story = {
    args: {groups},
}
