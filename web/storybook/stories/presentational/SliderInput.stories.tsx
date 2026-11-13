import * as React from "react"

import {SliderInput} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Forms/SliderInput",
    component: SliderInput,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A controlled number input + clear button stacked above a slider, for bounded numeric parameters (temperature, max tokens, top P, penalties). Composes the `@agenta/ui` `InputNumber` and `Slider` primitives.\n\n**Used in:** nowhere — zero call-sites today.",
            },
        },
    },
} satisfies Meta<typeof SliderInput>

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_16rem] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[220px]">{children}</div>
    </div>
)

interface CellProps {
    initial?: number | null
    min?: number
    max?: number
    step?: number
    disabled?: boolean
    allowClear?: boolean
    placeholder?: string
}

function Cell({initial = 0.7, ...props}: CellProps) {
    const [value, setValue] = React.useState<number | null>(initial)
    return <SliderInput value={value} onChange={setValue} {...props} />
}

export const Variants: Story = {
    render: () => (
        <div className="flex w-[736px] flex-col">
            <Row label="default (0–1, step 0.1)">
                <Cell />
            </Row>
            <Row label="range 0–2 (temperature)">
                <Cell max={2} initial={1.4} />
            </Row>
            <Row label="empty (placeholder, no clear)">
                <Cell initial={null} placeholder="auto" />
            </Row>
            <Row label="allowClear=false">
                <Cell allowClear={false} />
            </Row>
            <Row label="disabled">
                <Cell disabled />
            </Row>
        </div>
    ),
}
