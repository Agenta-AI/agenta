import {useState} from "react"

import {ChipsInput, DateTimeInput, MultiSelect, SchemaForm} from "@agenta/entity-ui/gatewayTool"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {DatePicker as AntDatePicker, Select as AntSelect} from "antd"

// SchemaForm — JSON-schema-driven form renderer. A full parity pair would replay the whole
// 1400-line pre-migration file, so the form itself is a showcase (all field kinds, both
// themes) and the parity grid covers only the three NEW composed controls this migration
// introduced: MultiSelect (antd `Select mode="multiple"`), ChipsInput (antd
// `Select mode="tags"` with `open={false}`), DateTimeInput (antd `DatePicker` — declared
// structural deviation: native picker instead of antd's popup calendar).
const meta = {
    title: "@agenta/entity-ui/GatewayTool/SchemaForm",
    component: SchemaForm,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Schema-driven form. Leaves migrated to @agenta/ui (Input/InputNumber/Switch/Select/Accordion/Buttons + composed MultiSelect/ChipsInput/DateTimeInput). The antd `Form` engine is retained deliberately — its `FormInstance` prop is cross-package API (ElicitationWidget, gatewayTrigger).",
            },
        },
    },
} satisfies Meta<typeof SchemaForm>

export default meta
type Story = StoryObj

const BASIC_SCHEMA = {
    type: "object",
    required: ["subject", "count"],
    properties: {
        subject: {type: "string", title: "Subject", description: "What the message is about"},
        count: {type: "integer", title: "Count"},
        urgent: {type: "boolean", title: "Urgent"},
        channel: {type: "string", title: "Channel", enum: ["email", "slack", "sms"]},
        notes: {type: "string", title: "Notes"},
        labels: {type: "array", title: "Labels", items: {type: "string"}},
    },
}

const OPEN_ENUM_SCHEMA = {
    type: "object",
    required: ["priority"],
    properties: {
        priority: {
            type: "string",
            title: "Priority",
            oneOf: [
                {const: "p0", title: "Critical", description: "Drop everything"},
                {const: "p1", title: "High", description: "This sprint"},
                {const: "p2", title: "Normal", description: "When convenient"},
            ],
        },
        reviewers: {
            type: "array",
            title: "Reviewers",
            items: {type: "string", enum: ["ada", "grace", "alan"]},
        },
        due: {type: "string", title: "Due", format: "date-time"},
    },
}

/** All field kinds: required inputs, number, switch, enum select, optional collapse. */
export const Default: Story = {
    render: () => (
        <div className="max-w-[520px]">
            <SchemaForm schema={BASIC_SCHEMA} />
        </div>
    ),
}

/** Elicitation mode: choice cards (oneOf descriptions), multi-select, date-time. */
export const OpenEnums: Story = {
    render: () => (
        <div className="max-w-[520px]">
            <SchemaForm schema={OPEN_ENUM_SCHEMA} formats openEnums flat />
        </div>
    ),
}

/** One-question-at-a-time stepper with the review step. */
export const Stepper: Story = {
    render: () => (
        <div className="max-w-[520px]">
            <SchemaForm schema={OPEN_ENUM_SCHEMA} formats openEnums stepper />
        </div>
    ),
}

/** Disabled (execution in flight) — every leaf must take the disabled skin. */
export const Disabled: Story = {
    render: () => (
        <div className="max-w-[520px]">
            <SchemaForm schema={BASIC_SCHEMA} disabled />
        </div>
    ),
}

// ---------------------------------------------------------------------------
// Parity: the three new composed controls vs their antd originals
// ---------------------------------------------------------------------------

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

const OPTIONS = [
    {value: "ada", label: "Ada"},
    {value: "grace", label: "Grace"},
    {value: "alan", label: "Alan"},
]

function ControlsComparison() {
    const [multi, setMulti] = useState<string[]>(["ada"])
    const [chips, setChips] = useState<string[] | undefined>(["alpha", "beta"])
    return (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="multi-select"
                a={
                    <AntSelect
                        mode="multiple"
                        className="w-full"
                        value={multi}
                        onChange={setMulti}
                        options={OPTIONS}
                        placeholder="Reviewers"
                    />
                }
                s={
                    <MultiSelect
                        value={multi}
                        onChange={setMulti}
                        options={OPTIONS}
                        placeholder="Reviewers"
                    />
                }
            />
            <Row
                label="tags input"
                a={
                    <AntSelect
                        mode="tags"
                        className="w-full"
                        value={chips ?? []}
                        onChange={(v: string[]) => setChips(v.length ? v : undefined)}
                        open={false}
                        suffixIcon={null}
                        placeholder="Labels"
                    />
                }
                s={<ChipsInput value={chips} onChange={setChips} placeholder="Labels" />}
            />
            <Row
                label="date-time"
                expected="antd DatePicker popup calendar not reproduced — native datetime-local input styled as ui Input (no calendar primitive in @agenta/ui); value stays dayjs"
                a={<AntDatePicker className="w-full" showTime />}
                s={<DateTimeInput showTime aria-label="Date and time" />}
            />
        </div>
    )
}

export const AntdVsAgenta: Story = {
    render: () => <ControlsComparison />,
}
