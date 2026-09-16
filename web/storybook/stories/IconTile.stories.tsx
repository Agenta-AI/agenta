import {Button, IconTile} from "@agenta/ui/ui"
import {Plugs, Plus} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// No antd counterpart: the tile is new, so this is a one-column showcase rather than a parity grid.
const meta = {
    title: "@agenta/ui/Primitives/Display/IconTile",
    component: IconTile,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The rounded square that leads a server row, a sheet header and the empty states. Four sizes, each paired with its own radius and glyph size, and two tones: `info` for identity, `muted` for an empty state.\n\n**Used in:** the MCP agent rail, the add-server drawer, the connect sheet, the permission drawer and the Settings registry.",
            },
        },
    },
    args: {size: 28, tone: "info", children: <Plugs />},
} satisfies Meta<typeof IconTile>

export default meta
type Story = StoryObj<typeof meta>

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-4" data-vrt-subject>
            {children}
        </div>
    </div>
)

export const Showcase: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="info · 24 / 28 / 32 / 44">
                <IconTile size={24}>
                    <Plugs />
                </IconTile>
                <IconTile size={28}>
                    <Plugs />
                </IconTile>
                <IconTile size={32}>
                    <Plugs />
                </IconTile>
                <IconTile size={44}>
                    <Plugs />
                </IconTile>
            </Row>
            <Row label="muted · 24 / 28 / 32 / 44">
                <IconTile size={24} tone="muted">
                    <Plugs />
                </IconTile>
                <IconTile size={28} tone="muted">
                    <Plugs />
                </IconTile>
                <IconTile size={32} tone="muted">
                    <Plugs />
                </IconTile>
                <IconTile size={44} tone="muted">
                    <Plugs />
                </IconTile>
            </Row>
            <Row label="any glyph, inheriting the tone">
                <IconTile size={28}>
                    <Plus />
                </IconTile>
                <IconTile size={28} tone="muted">
                    <Plus />
                </IconTile>
            </Row>
        </div>
    ),
}

// The tile is presentational: it has no states of its own, so the states worth drawing are the
// two surfaces it appears on — a row that hovers as a whole, and an empty state.
export const InContext: Story = {
    render: () => (
        <div className="flex max-w-[480px] flex-col gap-4">
            <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-3 rounded-control border border-solid border-colorBorderSecondary bg-colorBgElevated px-3.5 py-3 text-left hover:bg-colorFillTertiary"
                data-vrt-subject
            >
                <IconTile size={28}>
                    <Plugs />
                </IconTile>
                <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-colorText">Linear</span>
                    <span className="truncate font-mono text-xs text-colorTextTertiary">
                        mcp.linear.app
                    </span>
                </span>
            </button>
            <div
                className="flex flex-col items-center gap-3 rounded-control border border-dashed border-colorBorder px-6 py-12 text-center"
                data-vrt-subject
            >
                <IconTile size={44} tone="muted">
                    <Plugs />
                </IconTile>
                <span className="text-[15px] font-medium text-colorText">No MCP servers yet</span>
                <span className="max-w-[320px] text-[13px] leading-relaxed text-colorTextSecondary">
                    Connect a server to give your agents its tools.
                </span>
                <Button size="sm">
                    <Plus />
                    Add server
                </Button>
            </div>
        </div>
    ),
}
