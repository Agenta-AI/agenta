import {CopyButton} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Buttons/CopyButton",
    component: CopyButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Facade over the @agenta/ui Button (variant="outline") that copies text and swaps to a check icon after copying.\n\n**Used in:** 14 places — agent chat markdown and the inspector rows/lenses, the trace span drill-in and trace drawer accordion, the drives explorer, the dynamic code block, eval-run cell popovers, the webhook secret reveal, the tracing setup and create-testset-from-API modals, and two agent config drill-in controls.',
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row label="text + icon">
                <CopyButton text="hello world" icon />
            </Row>
            <Row label="text only">
                <CopyButton text="hello world" />
            </Row>
            <Row label="icon only">
                <CopyButton text="hello world" icon buttonText={null} size="icon" />
            </Row>
            <Row label="custom label">
                <CopyButton text="const x = 1" icon buttonText="Copy Code" />
            </Row>
        </div>
    ),
}
