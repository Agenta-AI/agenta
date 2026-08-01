import {ImageAttachment} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

// ImageAttachment is a pure-presentational image thumbnail with an optional hover-remove
// button. It wraps a plain <img>, not an antd component, so there is no antd counterpart to
// diff against — it renders alone.
const meta = {
    title: "@agenta/ui/Presentational/Attachments/ImageAttachment",
    component: ImageAttachment,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A pure-presentational image thumbnail with an optional hover-reveal remove button. Wraps a plain `<img>`, not an antd component, so it has no antd counterpart.\n\n**Used in:** 1 place — the chat message attachment strip (`@agenta/ui/chat-message` `MessageAttachments`).",
            },
        },
    },
} satisfies Meta<typeof ImageAttachment>

export default meta
type Story = StoryObj

// Stable data-URI keeps the VRT deterministic (no network image flake).
const IMG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' fill='#4096ff'/><circle cx='32' cy='24' r='11' fill='#fff'/><rect x='14' y='42' width='36' height='20' rx='10' fill='#fff'/></svg>`,
    )

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
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
        <div className="flex max-w-[640px] flex-col">
            <Row label="default (size 64)">
                <ImageAttachment src={IMG} alt="attachment" />
            </Row>
            <Row label="with remove (hover to reveal)">
                <ImageAttachment src={IMG} alt="attachment" onRemove={() => undefined} />
            </Row>
            <Row label="disabled (no remove)">
                <ImageAttachment src={IMG} alt="attachment" disabled onRemove={() => undefined} />
            </Row>
            <Row label="custom size (40)">
                <ImageAttachment src={IMG} alt="attachment" size={40} />
            </Row>
        </div>
    ),
}
