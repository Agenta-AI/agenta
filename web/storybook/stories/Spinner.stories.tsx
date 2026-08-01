import type {Meta, StoryObj} from "@storybook/nextjs"
import {Spin as AntSpin} from "antd"

// Spinner is not exported from the `@agenta/ui/ui` barrel yet (index.ts is off-limits for
// this change), so the story imports the primitive directly from its source file.
import {Spinner} from "../../packages/agenta-ui/src/components/ui/spinner"

// Phase-0 parity story: the REAL antd Spin behind the app theme, side by side with the
// @agenta/ui re-skin. antd's default indicator is the rotating 4-dot square; `size`
// (small/default/large) and `tip` map 1:1. The indicator rotates, so the VRT compares it
// at a frozen frame — a static (angle-0) match is the contract; residual rotation phase is
// expected animation-phase noise.
const meta = {
    title: "@agenta/ui/Primitives/Feedback/Spinner",
    component: AntSpin,
    subcomponents: {"Spinner (@agenta/ui)": Spinner},
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "antd `Spin` (interactive playground) shown beside the `@agenta/ui` Spinner that replaces it. See the subcomponent table below for the agenta props.\n\n**Used in:** 12 places — four entity picker variants, the searchable list/popover and virtual list shells, `LoadMoreButton`/`LoadAllButton`, `SharedEditor`, the prompt image upload, and the toast.",
            },
        },
    },
} satisfies Meta<typeof AntSpin>

export default meta
type Story = StoryObj<typeof meta>

// `.grid` Row: [label | antd cell | agenta cell] — the VRT pairs the Spin in each cell.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="flex h-16 items-center">{a}</div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="flex h-16 items-center">{s}</div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row label="small" a={<AntSpin size="small" />} s={<Spinner size="small" />} />
            {/* antd deprecates passing size="default" explicitly — omit it for the default. */}
            <Row label="default" a={<AntSpin />} s={<Spinner size="default" />} />
            <Row label="large" a={<AntSpin size="large" />} s={<Spinner size="large" />} />
            <Row label="with tip" a={<AntSpin tip="Loading…" />} s={<Spinner tip="Loading…" />} />
        </div>
    ),
}

export const Sizes: Story = {
    render: () => (
        <div className="flex items-center gap-8">
            <Spinner size="small" />
            <Spinner size="default" />
            <Spinner size="large" />
        </div>
    ),
}

export const WithTip: Story = {
    render: () => (
        <div className="flex items-center gap-8">
            <Spinner size="small" tip="Loading…" />
            <Spinner size="default" tip="Loading…" />
            <Spinner size="large" tip="Loading…" />
        </div>
    ),
}
