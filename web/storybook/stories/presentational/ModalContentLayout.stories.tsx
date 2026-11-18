import {ModalContentLayout} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Layout/ModalContentLayout",
    component: ModalContentLayout,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A modal-body layout: picker (left) + content (right) via SplitPanelLayout, with an optional bordered footer.\n\n**Used in:** 1 place — the selection modal shell (`@agenta/ui` `components/selection/SelectionModalShell.tsx`), which backs the entity selector modal.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Picker = () => <div className="text-xs text-colorText">Testset picker</div>
const Content = () => <div className="text-xs text-colorText">Testcase preview table</div>
const Footer = () => (
    <>
        <Button variant="ghost">Cancel</Button>
        <Button>Confirm</Button>
    </>
)

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="h-[200px] w-[430px] overflow-hidden">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[1020px] flex-col">
            <Row label="picker + content + footer">
                <ModalContentLayout
                    pickerWidth={200}
                    picker={<Picker />}
                    content={<Content />}
                    footer={<Footer />}
                />
            </Row>
            <Row label="no footer">
                <ModalContentLayout pickerWidth={200} picker={<Picker />} content={<Content />} />
            </Row>
        </div>
    ),
}
