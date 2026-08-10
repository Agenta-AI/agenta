import {PanelFooter} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// PanelFooter — a top-bordered footer row with configurable alignment, for modals/panels. A layout
// primitive with no antd counterpart, shown alone.
const meta = {
    title: "@agenta/ui/Presentational/Layout/PanelFooter",
    component: PanelFooter,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A top-bordered footer row with configurable alignment for modals and panels. A pure @agenta/ui layout primitive with no single antd counterpart.\n\n**Used in:** 1 place — inside `ModalContentLayout` (`@agenta/ui` presentational). No direct app call-site.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, s}: {label: string; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <span className="text-[10px] italic text-colorTextSecondary">
                no single antd counterpart (composite of @agenta/ui primitives / layout)
            </span>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[320px] rounded-lg border border-solid border-colorBorderSecondary">
                {s}
            </div>
        </div>
    </div>
)

export const AgentaOnly: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row
                label='align="between"'
                s={
                    <PanelFooter align="between">
                        <Button variant="ghost">Cancel</Button>
                        <Button>Save</Button>
                    </PanelFooter>
                }
            />
            <Row
                label='align="end" (default)'
                s={
                    <PanelFooter>
                        <Button variant="ghost">Cancel</Button>
                        <Button>Save</Button>
                    </PanelFooter>
                }
            />
            <Row
                label='align="center"'
                s={
                    <PanelFooter align="center">
                        <Button>Done</Button>
                    </PanelFooter>
                }
            />
        </div>
    ),
}
