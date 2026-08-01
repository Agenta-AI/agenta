import {useState} from "react"

import {EditableText} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Input as AntdInput, Tooltip, Typography} from "antd"

// EditableText is an inline click-to-edit text control (display mode + @agenta/ui Input edit
// mode, Enter/Escape/blur handling). The antd cell reproduces the pre-migration antd body
// (commit 041a1c834d): `Tooltip` + `Typography.Text` with a click handler and a
// hover-underline affordance — NOT `Typography.Text editable`, which is a different control
// (pencil button + textarea) that this component never used. The two halves share the same
// utility classes so the diff isolates the primitives (antd Tooltip/Text vs Radix Tooltip/span).
const {Text} = Typography

const meta = {
    title: "@agenta/ui/Presentational/Forms/EditableText",
    component: EditableText,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "An inline click-to-edit text control (display mode + @agenta/ui Input edit mode, Enter/Escape/blur handling). A pure @agenta/ui composite; the nearest antd counterpart is Typography.Text with editable.\n\n**Used in:** 2 places — the Lexical editor form nodes (`@agenta/ui/editor` primitive and object nodes). No app file imports it.",
            },
        },
    },
} satisfies Meta<typeof EditableText>

export default meta
type Story = StoryObj

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="flex items-center">{a}</div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="flex items-center">{s}</div>
        </div>
    </div>
)

const AntdEditable = ({initial, monospace}: {initial: string; monospace?: boolean}) => {
    const [value, setValue] = useState(initial)
    const [editing, setEditing] = useState(false)
    if (editing) {
        return (
            <AntdInput
                size="small"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => setEditing(false)}
                autoFocus
                className={`w-32 ${monospace ? "font-mono" : ""} text-xs`}
            />
        )
    }
    return (
        <Tooltip title="Click to edit">
            <Text
                // `.ant-typography` is not in the harness SUBJECT list; opt this span in explicitly
                // so the pair is [antd Text | agenta span], not [caption | agenta span].
                data-vrt-subject
                className={`text-xs cursor-pointer hover:text-colorPrimary hover:underline ${
                    monospace ? "font-mono" : ""
                }`}
                onClick={() => setEditing(true)}
            >
                {value || <span className="text-colorTextTertiary italic">Enter value...</span>}
            </Text>
        </Tooltip>
    )
}

const AgentaEditable = ({initial, monospace}: {initial: string; monospace?: boolean}) => {
    const [value, setValue] = useState(initial)
    return <EditableText value={value} onChange={setValue} monospace={monospace} />
}

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row
                label="click to edit"
                a={<AntdEditable initial="rename-me" monospace={false} />}
                s={<AgentaEditable initial="rename-me" monospace={false} />}
            />
            <Row
                label="monospace value"
                a={<AntdEditable initial="variant_slug" monospace />}
                s={<AgentaEditable initial="variant_slug" />}
            />
            <Row
                label="empty (placeholder)"
                a={<AntdEditable initial="" monospace={false} />}
                s={<AgentaEditable initial="" monospace={false} />}
            />
        </div>
    ),
}
