import * as React from "react"

import {SliderInput} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {XCircle} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {InputNumber as AntInputNumber, Slider as AntSlider} from "antd"

// SliderInput is a number field + clear button stacked above a slider, for bounded numeric
// parameters (temperature, top P, penalties).
//
// BASELINE: the antd cell reproduces the pre-migration component
// (`git show HEAD:…/presentational/inputs/SliderInput.tsx`) — an antd `InputNumber size="small"`
// with `[&_input]:!text-center` and `style={{width: inputWidth}}`, the same ghost clear Button,
// and an antd `Slider` under it. The clear Button was ALREADY the `@agenta/ui` Button at HEAD, so
// both cells use it — the row measures the two controls this migration actually changed.
const meta = {
    title: "@agenta/ui/Presentational/Forms/SliderInput",
    component: SliderInput,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A controlled number input + clear button stacked above a slider, for bounded numeric parameters (temperature, max tokens, top P, penalties). Composes the `@agenta/ui` `InputNumber` and `Slider` primitives; no antd.\n\n**Used in:** nowhere — zero call-sites today. It is unadopted rather than unwanted: `pages/evaluations/onlineEvaluation/components/SamplingRateControl.tsx` and `EvalRunDetails/.../ScenarioAnnotationPanel/MetricField.tsx` are hand-rolled antd `Slider` + `InputNumber` pairs, i.e. this component open-coded, and are its natural adopters.",
            },
        },
    },
} satisfies Meta<typeof SliderInput>

export default meta
type Story = StoryObj

// `.grid` Row: [label | antd cell | agenta cell] with the exact "antd"/"agenta" captions the VRT
// keys on. FIXED column widths (not `1fr`) so both cells land on the same sub-pixel phase.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_16rem_16rem] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

// Both cells share the SAME fixed box carrying `data-vrt-subject`, so the VRT compares the WHOLE
// composite. Without it each side's first SUBJECT match is only the number field
// (`.ant-input-number` / `[data-slot=input-number]`) and the slider never gets measured.
const Box = ({children}: {children: React.ReactNode}) => (
    <div data-vrt-subject className="w-[220px]">
        {children}
    </div>
)

// `.ant-slider` carries `margin: 9px 5px` here, which the migrated Slider primitive does not.
const NO_MARGIN = "!m-0"

interface CellProps {
    initial?: number | null
    min?: number
    max?: number
    step?: number
    disabled?: boolean
    allowClear?: boolean
    placeholder?: string
}

function AntdCell({
    initial = 0.7,
    min = 0,
    max = 1,
    step = 0.1,
    disabled = false,
    allowClear = true,
    placeholder,
}: CellProps) {
    const [value, setValue] = React.useState<number | null>(initial)
    return (
        <Box>
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                    <AntInputNumber
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        onChange={(v) => setValue(v as number | null)}
                        disabled={disabled}
                        className="[&_input]:!text-center"
                        style={{width: 70}}
                        placeholder={placeholder}
                        size="small"
                    />
                    {allowClear && value !== null && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setValue(null)}
                            disabled={disabled}
                        >
                            <XCircle size={14} />
                        </Button>
                    )}
                </div>
                <AntSlider
                    min={min}
                    max={max}
                    step={step}
                    value={value ?? min}
                    disabled={disabled}
                    onChange={(v) => setValue(v as number)}
                    className={NO_MARGIN}
                />
            </div>
        </Box>
    )
}

function AgentaCell({initial = 0.7, ...props}: CellProps) {
    const [value, setValue] = React.useState<number | null>(initial)
    return (
        <Box>
            <SliderInput value={value} onChange={setValue} {...props} />
        </Box>
    )
}

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex w-[736px] flex-col">
            <Row label="default (0–1, step 0.1)" a={<AntdCell />} s={<AgentaCell />} />
            <Row
                label="range 0–2 (temperature)"
                a={<AntdCell max={2} initial={1.4} />}
                s={<AgentaCell max={2} initial={1.4} />}
            />
            <Row
                label="empty (placeholder, no clear)"
                a={<AntdCell initial={null} placeholder="auto" />}
                s={<AgentaCell initial={null} placeholder="auto" />}
            />
            <Row
                label="allowClear=false"
                a={<AntdCell allowClear={false} />}
                s={<AgentaCell allowClear={false} />}
            />
            <Row label="disabled" a={<AntdCell disabled />} s={<AgentaCell disabled />} />
        </div>
    ),
}
