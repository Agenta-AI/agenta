import {useState} from "react"

import {LabelInput} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

// LabelInput is a bordered box with the label sitting inside the border above a borderless
// input / password / textarea, used for compact credential forms. Pure presentational (composes
// the @agenta/ui Input primitives), no single antd counterpart.
const meta = {
    title: "@agenta/ui/Presentational/Forms/LabelInput",
    component: LabelInput,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A bordered box with the label inside the border above a borderless input/password/textarea, for compact credential forms. A pure @agenta/ui composite of the Input primitives with no single antd counterpart.\n\n**Used in:** 1 place — the custom secret-provider form (`@agenta/entity-ui` `secretProvider/CustomProviderForm.tsx`).",
            },
        },
    },
} satisfies Meta<typeof LabelInput>

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="flex flex-col gap-0.5">
            <span className="text-xs text-colorTextSecondary">{label}</span>
            <span className="text-[10px] text-colorTextSecondary">
                no single antd counterpart (composite of @agenta/ui primitives / layout)
            </span>
        </div>
        <div className="w-[280px]">{children}</div>
    </div>
)

const Controlled = ({
    label,
    type,
    multiLine,
    placeholder,
}: {
    label: string
    type?: "text" | "password" | "url"
    multiLine?: boolean
    placeholder?: string
}) => {
    const [value, setValue] = useState("")
    return (
        <LabelInput
            label={label}
            type={type}
            multiLine={multiLine}
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
        />
    )
}

export const AgentaOnly: Story = {
    render: () => (
        <div className="flex max-w-[680px] flex-col">
            <Row label="text input">
                <Controlled label="Name" placeholder="Enter a name" />
            </Row>
            <Row label="password input">
                <Controlled label="API key *" type="password" placeholder="Enter API key" />
            </Row>
            <Row label="multi-line (textarea)">
                <Controlled label="Description" multiLine placeholder="Describe the resource" />
            </Row>
        </div>
    ),
}
