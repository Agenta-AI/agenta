import {useState} from "react"

import {PromptDocumentUpload} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Attachments/PromptDocumentUpload",
    component: PromptDocumentUpload,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A drag-and-drop PDF uploader (file + URL input). Built on a native drop-zone (`usePromptFileUpload` hook) + @agenta/ui primitives (InputAffix).\n\n**Used in:** 1 place — the playground turn-message adapter (`@agenta/playground-ui` `adapters/TurnMessageAdapter.tsx`).",
            },
        },
    },
} satisfies Meta<typeof PromptDocumentUpload>

export default meta
type Story = StoryObj

const Controlled = ({disabled}: {disabled?: boolean}) => {
    const [value, setValue] = useState("")
    return (
        <PromptDocumentUpload
            disabled={disabled}
            value={value}
            onFileChange={(fileData) => setValue(fileData)}
            onRemove={() => setValue("")}
        />
    )
}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[320px]">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row label="empty">
                <Controlled />
            </Row>
            <Row label="disabled">
                <Controlled disabled />
            </Row>
        </div>
    ),
}
