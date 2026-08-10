import {AttachmentGrid, FileAttachment, ImageAttachment} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

// AttachmentGrid is a pure-presentational flex layout container that wraps a set of
// ImageAttachment / FileAttachment children. It is a plain <div> wrapper, not an antd
// component, so it renders alone with no antd counterpart to diff.
const meta = {
    title: "@agenta/ui/Presentational/Attachments/AttachmentGrid",
    component: AttachmentGrid,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A pure-presentational flex layout container that wraps ImageAttachment / FileAttachment children. A plain `<div>` wrapper with no antd counterpart.\n\n**Used in:** 1 place — the chat message attachment strip (`@agenta/ui/chat-message` `MessageAttachments`).",
            },
        },
    },
} satisfies Meta<typeof AttachmentGrid>

export default meta
type Story = StoryObj

const IMG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' fill='#4096ff'/><circle cx='32' cy='24' r='11' fill='#fff'/><rect x='14' y='42' width='36' height='20' rx='10' fill='#fff'/></svg>`,
    )

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="flex flex-col gap-0.5">
            <span className="text-xs text-colorTextSecondary">{label}</span>
            <span className="text-[10px] text-colorTextSecondary">
                no single antd counterpart (composite of @agenta/ui primitives / layout)
            </span>
        </div>
        <div className="flex items-center">{children}</div>
    </div>
)

export const AgentaOnly: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row label="mixed image + file children">
                <AttachmentGrid>
                    <ImageAttachment src={IMG} alt="one" onRemove={() => undefined} />
                    <ImageAttachment src={IMG} alt="two" onRemove={() => undefined} />
                    <FileAttachment filename="notes.pdf" onRemove={() => undefined} />
                </AttachmentGrid>
            </Row>
            <Row label="files only (wraps)">
                <AttachmentGrid>
                    <FileAttachment filename="a.pdf" onRemove={() => undefined} />
                    <FileAttachment filename="b.xlsx" onRemove={() => undefined} />
                    <FileAttachment filename="c.docx" onRemove={() => undefined} />
                </AttachmentGrid>
            </Row>
            <Row label="wider gap (gap=4)">
                <AttachmentGrid gap={4}>
                    <ImageAttachment src={IMG} alt="one" />
                    <ImageAttachment src={IMG} alt="two" />
                </AttachmentGrid>
            </Row>
        </div>
    ),
}
