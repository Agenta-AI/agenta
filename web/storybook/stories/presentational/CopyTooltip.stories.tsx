import {CopyTooltip} from "@agenta/ui/copy-tooltip"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Feedback/CopyTooltip",
    component: CopyTooltip,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Wraps its single child in an @agenta/ui Tooltip (Radix) and copies `copyText` on click, briefly swapping the tooltip to a confirmation.\n\n**Used in:** 16 places — the layout breadcrumb, observability columns and the sessions table, the trace drawer header/type/linked-spans panels, the session drawer header and message panel, eval-run focus drawer and configuration fields, reference chips and query cells, organization settings, the EE audit-log cells, the annotation session navigation, and the playground tool-call view.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row label="hover, then click to copy">
                <CopyTooltip title="Click to copy" copyText="call_abc123">
                    <span className="text-xs text-colorText underline decoration-dotted">
                        call_abc123
                    </span>
                </CopyTooltip>
            </Row>
        </div>
    ),
}
