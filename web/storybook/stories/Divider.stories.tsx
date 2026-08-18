import {Divider} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Divider as AntDivider} from "antd"

// Phase-0 parity story: the REAL antd Divider behind the app theme, side by side with the
// @agenta/ui re-skin. antd `type`(horizontal/vertical)/`orientation`/`dashed`/`plain`/`children`
// map to the same props on the @agenta/ui component.
const meta = {
    title: "@agenta/ui/Primitives/Display/Divider",
    component: AntDivider,
    subcomponents: {"Divider (@agenta/ui)": Divider},
    parameters: {
        docs: {
            description: {
                component:
                    "antd `Divider` (interactive playground) shown beside the `@agenta/ui` Divider that replaces it. See the subcomponent table below for the agenta props.\n\n**Used in:** 2 places — `SplitPanelLayout` and the entity picker list-popover variant.",
            },
        },
    },
} satisfies Meta<typeof AntDivider>

export default meta
type Story = StoryObj<typeof meta>

// `.grid` Row: [label | antd cell | agenta cell]. A fixed-width slot keeps the full-width
// horizontal dividers a consistent size so the VRT compares like for like.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[220px]">{a}</div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[220px]">{s}</div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row label="horizontal" a={<AntDivider />} s={<Divider />} />
            <Row label="horizontal · dashed" a={<AntDivider dashed />} s={<Divider dashed />} />
            <Row
                label="with text (center)"
                a={<AntDivider>Text</AntDivider>}
                s={<Divider>Text</Divider>}
            />
            <Row
                label="with text (left)"
                a={<AntDivider titlePlacement="left">Text</AntDivider>}
                s={<Divider orientation="left">Text</Divider>}
            />
            <Row
                label="with text · plain"
                a={<AntDivider plain>Text</AntDivider>}
                s={<Divider plain>Text</Divider>}
            />
            <Row
                label="vertical"
                a={
                    <span className="text-xs text-colorText">
                        Left
                        <AntDivider type="vertical" />
                        Right
                    </span>
                }
                s={
                    <span className="text-xs text-colorText">
                        Left
                        <Divider type="vertical" />
                        Right
                    </span>
                }
            />
        </div>
    ),
}
