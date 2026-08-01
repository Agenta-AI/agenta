import {useState} from "react"

import {HeightCollapse} from "@agenta/ui/components"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// HeightCollapse — a CSS-native height collapse (pixel ↔ auto via interpolate-size). A behavior
// wrapper with no antd counterpart; shown alone with a live toggle.
const meta = {
    title: "@agenta/ui/Presentational/Layout/HeightCollapse",
    component: HeightCollapse,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A CSS-native height collapse (pixel ↔ auto via interpolate-size). A pure @agenta/ui behavior wrapper with no antd counterpart.\n\n**Used in:** 11 places — the agent conversation, approval dock, tool activity and elicitation widget, the agent config drill-in sections and advanced fields, the commit changes summary, the playground chat mode and single-layout execution row, and `ConfigAccordionSection`.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const AntdOnly = () => (
    <span className="text-[10px] italic text-colorTextSecondary">
        no single antd counterpart (composite of @agenta/ui primitives / layout)
    </span>
)

const Panel = () => (
    <div className="rounded-lg border border-solid border-colorBorderSecondary p-3 text-xs text-colorTextSecondary">
        This content expands and collapses by animating its height between 0 and auto.
        <br />
        Line two.
        <br />
        Line three.
    </div>
)

const Demo = () => {
    const [open, setOpen] = useState(true)
    return (
        <div className="flex w-[320px] flex-col gap-2">
            <Button variant="outline" onClick={() => setOpen((v) => !v)}>
                {open ? "Collapse" : "Expand"}
            </Button>
            <HeightCollapse open={open}>
                <Panel />
            </HeightCollapse>
        </div>
    )
}

export const AgentaOnly: Story = {
    render: () => (
        <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4">
            <div className="text-xs text-colorTextSecondary">toggle open/closed</div>
            <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
                <AntdOnly />
            </div>
            <div className="flex flex-col gap-1">
                <span className="text-[10px] text-colorTextSecondary">agenta</span>
                <Demo />
            </div>
        </div>
    ),
}
