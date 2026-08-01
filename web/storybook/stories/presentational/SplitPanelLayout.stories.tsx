import {SplitPanelLayout} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Divider as AntDivider} from "antd"

// SplitPanelLayout — a two-column layout (fixed-width left panel + optional vertical divider +
// flexible right). Migrated off the antd `Divider`; the antd cell rebuilds the pre-migration body
// (same wrapper/panel classes, antd `Divider orientation="vertical"`) so the pair isolates the rule.
const meta = {
    title: "@agenta/ui/Presentational/Layout/SplitPanelLayout",
    component: SplitPanelLayout,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A two-column layout (fixed-width left panel + optional divider + flexible right). A pure @agenta/ui layout primitive that uses the @agenta/ui `Divider` primitive internally (migrated off antd).\n\n**Used in:** 1 place — inside `ModalContentLayout` (`@agenta/ui` presentational). No direct app call-site.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Left = () => <div className="text-xs text-colorText">Left panel (navigation / picker)</div>
const Right = () => <div className="text-xs text-colorText">Right panel (content / preview)</div>

// `data-vrt-subject` marks the crop box: the layout is plain <section>/<div>, which the generic
// subject list cannot match.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[9rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="h-[150px] w-[420px] overflow-hidden" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="h-[150px] w-[420px] overflow-hidden" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

// Verbatim reproduction of the pre-migration SplitPanelLayout body (`git show HEAD:presentational/
// layout/SplitPanelLayout.tsx`): identical section/panel classes, only the divider is antd's.
const AntdSplitPanelLayout = ({
    leftWidth = 180,
    showDivider = true,
}: {
    leftWidth?: number
    showDivider?: boolean
}) => (
    <section className="flex grow min-h-0 overflow-hidden h-full">
        <div
            className="flex flex-col min-h-0 h-full overflow-hidden gap-4 p-4"
            style={{width: leftWidth, minWidth: leftWidth, maxWidth: leftWidth}}
        >
            <Left />
        </div>
        {showDivider && <AntDivider orientation="vertical" className="m-0 h-full" />}
        <div className="flex flex-col w-full h-full grow min-h-0 overflow-hidden gap-4 p-4">
            <Right />
        </div>
    </section>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row
                label="with divider"
                a={<AntdSplitPanelLayout />}
                s={
                    <SplitPanelLayout
                        leftWidth={180}
                        left={<Left />}
                        right={<Right />}
                        className="h-full"
                    />
                }
            />
            <Row
                label="no divider"
                a={<AntdSplitPanelLayout showDivider={false} />}
                s={
                    <SplitPanelLayout
                        leftWidth={180}
                        showDivider={false}
                        left={<Left />}
                        right={<Right />}
                        className="h-full"
                    />
                }
            />
        </div>
    ),
}
