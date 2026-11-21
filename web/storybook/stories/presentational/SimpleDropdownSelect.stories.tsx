import {useState} from "react"

import {SimpleDropdownSelect} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Forms/SimpleDropdownSelect",
    component: SimpleDropdownSelect,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A lightweight select (a dropdown menu behind an @agenta/ui ghost Button trigger) used for role pickers in chat editors.\n\n**Used in:** 3 places — the chat message editor role picker (`@agenta/ui/chat-message`), the eval-run chat message renderer, and the agent config enum-select control.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const roleOptions = [
    {label: "User", value: "user"},
    {label: "Assistant", value: "assistant"},
    {label: "System", value: "system"},
]

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

const Demo = ({disabled}: {disabled?: boolean}) => {
    const [value, setValue] = useState("user")
    return (
        <SimpleDropdownSelect
            value={value}
            options={roleOptions}
            onChange={setValue}
            disabled={disabled}
        />
    )
}

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row label="default">
                <Demo />
            </Row>
            <Row label="disabled">
                <Demo disabled />
            </Row>
        </div>
    ),
}
