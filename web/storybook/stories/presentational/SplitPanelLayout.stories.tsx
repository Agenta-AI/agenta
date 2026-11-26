import {SplitPanelLayout} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Layout/SplitPanelLayout",
    component: SplitPanelLayout,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A two-column layout (fixed-width left panel + optional divider + flexible right). A pure @agenta/ui layout primitive that uses the @agenta/ui `Divider` primitive internally.\n\n**Used in:** 1 place — inside `ModalContentLayout` (`@agenta/ui` presentational). No direct app call-site.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Left = () => <div className="text-xs text-colorText">Left panel (navigation / picker)</div>
const Right = () => <div className="text-xs text-colorText">Right panel (content / preview)</div>

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="h-[150px] w-[420px] overflow-hidden">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row label="with divider">
                <SplitPanelLayout
                    leftWidth={180}
                    left={<Left />}
                    right={<Right />}
                    className="h-full"
                />
            </Row>
            <Row label="no divider">
                <SplitPanelLayout
                    leftWidth={180}
                    showDivider={false}
                    left={<Left />}
                    right={<Right />}
                    className="h-full"
                />
            </Row>
        </div>
    ),
}
