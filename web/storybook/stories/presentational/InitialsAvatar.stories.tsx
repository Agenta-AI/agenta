import {InitialsAvatar, getColorPairFromStr} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Avatar as AntAvatar} from "antd"

// InitialsAvatar extends antd Avatar: it derives initials + a deterministic color pair from a
// name and renders a square antd Avatar. The antd cell shows the plain antd Avatar it wraps;
// the agenta cell shows InitialsAvatar with its computed initials/colors.
const meta = {
    title: "@agenta/ui/Presentational/Media/InitialsAvatar",
    component: InitialsAvatar,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Extends antd Avatar: derives initials and a deterministic color pair from a name and renders a square antd Avatar.\n\n**Used in:** 7 places — the sidebar org and project lists, the sidebar selection button and its dropdown items, the workspace member rows, the annotation assignment cells, and the shared user author label.",
            },
        },
    },
} satisfies Meta<typeof InitialsAvatar>

export default meta
type Story = StoryObj

// The antd half must carry the SAME deterministic pair the component derives, or the whole box differs.
const pair = (name: string) => {
    const color = getColorPairFromStr(name)
    return {backgroundColor: color.backgroundColor, color: color.textColor}
}

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
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

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row
                label='name "Arda Erzin" — default'
                a={
                    <AntAvatar shape="square" style={pair("Arda Erzin")}>
                        AE
                    </AntAvatar>
                }
                s={<InitialsAvatar name="Arda Erzin" />}
            />
            <Row
                label='name "Jane Doe" — small'
                a={
                    <AntAvatar shape="square" size="small" style={pair("Jane Doe")}>
                        JD
                    </AntAvatar>
                }
                s={<InitialsAvatar name="Jane Doe" size="small" />}
            />
            <Row
                label='name "OpenAI" — large'
                a={
                    <AntAvatar shape="square" size="large" style={pair("OpenAI")}>
                        O
                    </AntAvatar>
                }
                s={<InitialsAvatar name="OpenAI" size="large" />}
            />
            <Row
                label="numeric size (24)"
                a={
                    <AntAvatar shape="square" size={24} style={pair("Anthropic Bot")}>
                        AB
                    </AntAvatar>
                }
                s={<InitialsAvatar name="Anthropic Bot" size={24} />}
            />
        </div>
    ),
}
