import {Divider} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Display/Divider",
    component: Divider,
    parameters: {
        docs: {
            description: {
                component:
                    "A horizontal or vertical divider line with optional `dashed`, `plain` and text (`orientation`) props.\n\n**Used in:** 2 places — `SplitPanelLayout` and the entity picker list-popover variant.",
            },
        },
    },
} satisfies Meta<typeof Divider>

export default meta
type Story = StoryObj<typeof meta>

// A fixed-width slot keeps the full-width horizontal dividers a consistent size.
const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[220px]">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[480px] flex-col">
            <Row label="horizontal">
                <Divider />
            </Row>
            <Row label="horizontal · dashed">
                <Divider dashed />
            </Row>
            <Row label="with text (center)">
                <Divider>Text</Divider>
            </Row>
            <Row label="with text (left)">
                <Divider orientation="left">Text</Divider>
            </Row>
            <Row label="with text · plain">
                <Divider plain>Text</Divider>
            </Row>
            <Row label="vertical">
                <span className="text-xs text-colorText">
                    Left
                    <Divider type="vertical" />
                    Right
                </span>
            </Row>
        </div>
    ),
}
