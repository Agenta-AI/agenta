import {PanelFooter} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Layout/PanelFooter",
    component: PanelFooter,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A top-bordered footer row with configurable alignment for modals and panels. A pure @agenta/ui layout primitive.\n\n**Used in:** 1 place — inside `ModalContentLayout` (`@agenta/ui` presentational). No direct app call-site.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[320px] rounded-lg border border-solid border-colorBorderSecondary">
            {children}
        </div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row label='align="between"'>
                <PanelFooter align="between">
                    <Button variant="ghost">Cancel</Button>
                    <Button>Save</Button>
                </PanelFooter>
            </Row>
            <Row label='align="end" (default)'>
                <PanelFooter>
                    <Button variant="ghost">Cancel</Button>
                    <Button>Save</Button>
                </PanelFooter>
            </Row>
            <Row label='align="center"'>
                <PanelFooter align="center">
                    <Button>Done</Button>
                </PanelFooter>
            </Row>
        </div>
    ),
}
