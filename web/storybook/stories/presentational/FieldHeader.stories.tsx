import {FieldHeader} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

// FieldHeader is a right-aligned copy-to-clipboard button used above table cells and field
// values (the legacy markdown toggle was removed). Pure presentational, no antd counterpart.
const meta = {
    title: "@agenta/ui/Presentational/Forms/FieldHeader",
    component: FieldHeader,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A right-aligned copy-to-clipboard button shown above table cells and field values. A pure @agenta/ui composite that uses the @agenta/ui Tooltip (Radix) internally.\n\n**Used in:** 1 place — the drill-in text field renderer (`@agenta/ui` `drill-in/FieldRenderers/TextField.tsx`).",
            },
        },
    },
} satisfies Meta<typeof FieldHeader>

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="flex flex-col gap-0.5">
            <span className="text-xs text-colorTextSecondary">{label}</span>
            <span className="text-[10px] text-colorTextSecondary">
                no single antd counterpart (composite; uses the @agenta/ui Tooltip internally)
            </span>
        </div>
        <div className="flex w-[220px] items-center">{children}</div>
    </div>
)

export const AgentaOnly: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label="copy button (with value)">
                <FieldHeader value="Some text content to copy" />
            </Row>
            <Row label="empty value (no-op copy)">
                <FieldHeader value="" />
            </Row>
        </div>
    ),
}
