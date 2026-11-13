import {useState} from "react"

import {EditableText} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Forms/EditableText",
    component: EditableText,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "An inline click-to-edit text control (display mode + @agenta/ui Input edit mode, Enter/Escape/blur handling).\n\n**Used in:** 2 places — the Lexical editor form nodes (`@agenta/ui/editor` primitive and object nodes). No app file imports it.",
            },
        },
    },
} satisfies Meta<typeof EditableText>

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

const Editable = ({initial, monospace}: {initial: string; monospace?: boolean}) => {
    const [value, setValue] = useState(initial)
    return <EditableText value={value} onChange={setValue} monospace={monospace} />
}

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row label="click to edit">
                <Editable initial="rename-me" monospace={false} />
            </Row>
            <Row label="monospace value">
                <Editable initial="variant_slug" />
            </Row>
            <Row label="empty (placeholder)">
                <Editable initial="" monospace={false} />
            </Row>
        </div>
    ),
}
