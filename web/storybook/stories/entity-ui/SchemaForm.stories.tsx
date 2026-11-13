import {useState} from "react"

import {ChipsInput, DateTimeInput, MultiSelect, SchemaForm} from "@agenta/entity-ui/gatewayTool"
import type {Meta, StoryObj} from "@storybook/nextjs"

// SchemaForm — JSON-schema-driven form renderer. The form itself is a showcase (all field
// kinds, both themes); the Variants story lists the three composed controls: MultiSelect,
// ChipsInput and DateTimeInput.
const meta = {
    title: "@agenta/entity-ui/GatewayTool/SchemaForm",
    component: SchemaForm,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Schema-driven form renderer: inputs, number fields, switches, selects, accordions, and the composed MultiSelect, ChipsInput and DateTimeInput controls.",
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

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

const OPTIONS = [
    {value: "ada", label: "Ada"},
    {value: "grace", label: "Grace"},
    {value: "alan", label: "Alan"},
]

function ControlsGallery() {
    const [multi, setMulti] = useState<string[]>(["ada"])
    const [chips, setChips] = useState<string[] | undefined>(["alpha", "beta"])
    return (
        <div className="flex max-w-[640px] flex-col">
            <Row label="multi-select">
                <MultiSelect
                    value={multi}
                    onChange={setMulti}
                    options={OPTIONS}
                    placeholder="Reviewers"
                />
            </Row>
            <Row label="tags input">
                <ChipsInput value={chips} onChange={setChips} placeholder="Labels" />
            </Row>
            <Row label="date-time">
                <DateTimeInput showTime aria-label="Date and time" />
            </Row>
        </div>
    )
}

export const Variants: Story = {
    render: () => <ControlsGallery />,
}
