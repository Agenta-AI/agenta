import {InitialsAvatar} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Media/InitialsAvatar",
    component: InitialsAvatar,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Derives initials and a deterministic color pair from a name and renders a square avatar.\n\n**Used in:** 7 places — the sidebar org and project lists, the sidebar selection button and its dropdown items, the workspace member rows, the annotation assignment cells, and the shared user author label.",
            },
        },
    },
} satisfies Meta<typeof InitialsAvatar>

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row label='name "Arda Erzin" — default'>
                <InitialsAvatar name="Arda Erzin" />
            </Row>
            <Row label='name "Jane Doe" — small'>
                <InitialsAvatar name="Jane Doe" size="small" />
            </Row>
            <Row label='name "OpenAI" — large'>
                <InitialsAvatar name="OpenAI" size="large" />
            </Row>
            <Row label="numeric size (24)">
                <InitialsAvatar name="Anthropic Bot" size={24} />
            </Row>
        </div>
    ),
}
