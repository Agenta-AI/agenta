import * as React from "react"

import {InputNumber} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {InputNumber as AntInputNumber} from "antd"

// InputNumber — cva numeric input in @agenta/ui reproducing the subset of antd `InputNumber`
// the app uses (stepper column + clamp + keyboard), re-skinned to the app theme. Replaces the
// antd `InputNumber` in presentational/inputs/SliderInput.tsx.
const meta = {
    title: "@agenta/ui/Primitives/Forms/InputNumber",
    component: InputNumber,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The `@agenta/ui` InputNumber (cva-based) that replaces antd `InputNumber`. Reproduces antd's hover-revealed stepper column, clamp-on-blur, and ArrowUp/ArrowDown keyboard stepping against the app theme. Deferred vs antd: formatter/parser, precision, addons, prefix.\n\n**Used in:** 2 places — the drill-in number field (`drill-in/FieldRenderers/NumberField.tsx`) and the editor form's primitive node (`Editor/form/nodes/PrimitiveNode.tsx`).",
            },
        },
    },
} satisfies Meta<typeof InputNumber>

export default meta
type Story = StoryObj<typeof InputNumber>

// data-vrt-subject wrapper: each cell holds wrapper + input + stepper buttons (2–4 candidates).
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <span data-vrt-subject className="inline-flex">
                {a}
            </span>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <span data-vrt-subject className="inline-flex">
                {s}
            </span>
        </div>
    </div>
)

// A tiny controlled harness so each cell owns its value (both libs are controlled).
function AntCell({
    initial = 0,
    ...props
}: {initial?: number | null} & React.ComponentProps<typeof AntInputNumber>) {
    const [value, setValue] = React.useState<number | null>(initial)
    return (
        <AntInputNumber value={value} onChange={(v) => setValue(v as number | null)} {...props} />
    )
}

function AgentaCell({
    initial = 0,
    ...props
}: {initial?: number | null} & React.ComponentProps<typeof InputNumber>) {
    const [value, setValue] = React.useState<number | null>(initial)
    return <InputNumber value={value} onChange={setValue} {...props} />
}

// antd's InputNumber is 90px intrinsic; ours is `w-full`. Pin both so the pixel diff measures
// the field, not the width delta (the VRT pads a size mismatch with opaque grey).
const W = {width: 120}

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row
                label="default"
                a={<AntCell initial={3} style={W} />}
                s={<AgentaCell initial={3} style={W} />}
            />
            <Row
                label="min/max/step (0–2, step 0.1)"
                a={<AntCell initial={0.5} min={0} max={2} step={0.1} style={W} />}
                s={<AgentaCell initial={0.5} min={0} max={2} step={0.1} style={W} />}
            />
            <Row
                label="placeholder (empty)"
                a={<AntCell initial={null} placeholder="0.0" style={W} />}
                s={<AgentaCell initial={null} placeholder="0.0" style={W} />}
            />
            <Row
                label="disabled"
                a={<AntCell initial={7} disabled style={W} />}
                s={<AgentaCell initial={7} disabled style={W} />}
            />
            <Row
                label='size="small"'
                a={<AntCell initial={1} size="small" style={W} />}
                s={<AgentaCell initial={1} size="small" style={W} />}
            />
            <Row
                label='size="middle"'
                a={<AntCell initial={1} size="middle" style={W} />}
                s={<AgentaCell initial={1} size="middle" style={W} />}
            />
            <Row
                label='size="large"'
                a={<AntCell initial={1} size="large" style={W} />}
                s={<AgentaCell initial={1} size="large" style={W} />}
            />
            <Row
                label="centered text (SliderInput usage)"
                a={
                    <AntCell
                        initial={0.7}
                        min={0}
                        max={2}
                        step={0.1}
                        size="small"
                        className="[&_input]:!text-center"
                        style={{width: 70}}
                    />
                }
                s={
                    <AgentaCell
                        initial={0.7}
                        min={0}
                        max={2}
                        step={0.1}
                        size="small"
                        className="[&_input]:!text-center"
                        style={{width: 70}}
                    />
                }
            />
        </div>
    ),
}
