import {useState} from "react"

import {SimpleDropdownSelect} from "@agenta/ui/components/presentational"
import {CaretUpDown} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button, Dropdown} from "antd"

// SimpleDropdownSelect — a lightweight role picker for chat editors: a ghost @agenta/ui Button
// trigger showing the current value plus a CaretUpDown, backed by a dropdown menu.
//
// The antd half reproduces the ACTUAL pre-migration component (see git e29e3f8586^):
// `<Dropdown menu={…} trigger={["click"]}><Button type="text" className="flex items-center
// capitalize px-2 hover:bg-zinc-2">{value} <CaretUpDown size={14}/></Button></Dropdown>`.
//
// It is NOT an antd `<Select>`. An earlier revision of this story used one, which made the
// pair read as a ~51% mismatch — but that was comparing a chrome-less text-button trigger
// against a 150px bordered combobox, i.e. a component this never was. The migration target
// is the borderless Dropdown trigger, so that is the baseline.
const meta = {
    title: "@agenta/ui/Presentational/Forms/SimpleDropdownSelect",
    component: SimpleDropdownSelect,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A lightweight select (antd Dropdown + @agenta/ui ghost Button trigger) used for role pickers in chat editors. A pure @agenta/ui composite; the antd counterpart is a plain Select.\n\n**Used in:** 3 places — the chat message editor role picker (`@agenta/ui/chat-message`), the eval-run chat message renderer, and the agent config enum-select control.",
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

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

const AgentaDemo = ({disabled}: {disabled?: boolean}) => {
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

/** The pre-migration antd implementation, reproduced verbatim as the parity baseline. */
const AntdOriginal = ({disabled}: {disabled?: boolean}) => (
    <Dropdown
        disabled={disabled}
        menu={{items: roleOptions.map((o) => ({key: o.value, label: o.label}))}}
        trigger={["click"]}
        styles={{root: {width: 150}}}
    >
        <Button className="flex items-center capitalize px-2 hover:bg-zinc-2" type="text">
            user <CaretUpDown size={14} />
        </Button>
    </Dropdown>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row label="default" a={<AntdOriginal />} s={<AgentaDemo />} />
            <Row label="disabled" a={<AntdOriginal disabled />} s={<AgentaDemo disabled />} />
        </div>
    ),
}
