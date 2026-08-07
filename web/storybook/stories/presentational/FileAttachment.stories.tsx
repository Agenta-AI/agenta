import {FileAttachment} from "@agenta/ui/components/presentational"
import {FilePdf} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// FileAttachment is a pure-presentational file pill (icon + truncated filename + optional
// remove). It composes the @agenta/ui Button and the @agenta/ui Tooltip (Radix) but is not a re-skin of any
// single antd component, so it renders alone with no antd counterpart to diff.
const meta = {
    title: "@agenta/ui/Presentational/Attachments/FileAttachment",
    component: FileAttachment,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A pure-presentational file pill (icon + truncated filename + optional remove). Composes the @agenta/ui Button and the @agenta/ui Tooltip (Radix) internally; no single antd counterpart.\n\n**Used in:** 1 place — the chat message attachment strip (`@agenta/ui/chat-message` `MessageAttachments`).",
            },
        },
    },
} satisfies Meta<typeof FileAttachment>

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="flex flex-col gap-0.5">
            <span className="text-xs text-colorTextSecondary">{label}</span>
            <span className="text-[10px] text-colorTextSecondary">
                no single antd counterpart (composite; uses the @agenta/ui Tooltip internally)
            </span>
        </div>
        <div className="flex items-center">{children}</div>
    </div>
)

export const AgentaOnly: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="default (with remove)">
                <FileAttachment filename="document.pdf" onRemove={() => undefined} />
            </Row>
            <Row label="disabled (no remove)">
                <FileAttachment filename="report.xlsx" disabled />
            </Row>
            <Row label="long filename (truncated)">
                <FileAttachment
                    filename="a-very-long-file-name-that-should-truncate.pdf"
                    onRemove={() => undefined}
                />
            </Row>
            <Row label="custom icon">
                <FileAttachment
                    filename="invoice.pdf"
                    icon={<FilePdf size={16} />}
                    onRemove={() => undefined}
                />
            </Row>
        </div>
    ),
}
