import * as React from "react"

import {InputNumber} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Forms/InputNumber",
    component: InputNumber,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The `@agenta/ui` InputNumber (cva-based) numeric input with a hover-revealed stepper column, clamp-on-blur and ArrowUp/ArrowDown keyboard stepping.\n\n**Used in:** 2 places — the drill-in number field (`drill-in/FieldRenderers/NumberField.tsx`) and the editor form's primitive node (`Editor/form/nodes/PrimitiveNode.tsx`).",
            },
        },
    },
} satisfies Meta<typeof InputNumber>

export default meta
type Story = StoryObj<typeof InputNumber>

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

// A tiny controlled harness so each row owns its value.
function Cell({
    initial = 0,
    ...props
}: {initial?: number | null} & React.ComponentProps<typeof InputNumber>) {
    const [value, setValue] = React.useState<number | null>(initial)
    return <InputNumber value={value} onChange={setValue} {...props} />
}

// The InputNumber is `w-full`, so pin a width.
const W = {width: 120}

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[480px] flex-col">
            <Row label="default">
                <Cell initial={3} style={W} />
            </Row>
            <Row label="min/max/step (0–2, step 0.1)">
                <Cell initial={0.5} min={0} max={2} step={0.1} style={W} />
            </Row>
            <Row label="placeholder (empty)">
                <Cell initial={null} placeholder="0.0" style={W} />
            </Row>
            <Row label="disabled">
                <Cell initial={7} disabled style={W} />
            </Row>
            <Row label='size="small"'>
                <Cell initial={1} size="small" style={W} />
            </Row>
            <Row label='size="middle"'>
                <Cell initial={1} size="middle" style={W} />
            </Row>
            <Row label='size="large"'>
                <Cell initial={1} size="large" style={W} />
            </Row>
            <Row label="centered text (SliderInput usage)">
                <Cell
                    initial={0.7}
                    min={0}
                    max={2}
                    step={0.1}
                    size="small"
                    className="[&_input]:!text-center"
                    style={{width: 70}}
                />
            </Row>
        </div>
    ),
}
