import {EnhancedButton} from "@agenta/ui/components/presentational"
import {Plus} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const ICON = <Plus size={14} />

const meta = {
    title: "@agenta/ui/Enhanced/Button",
    component: EnhancedButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A facade over the @agenta/ui Button and Radix Tooltip; takes `type`, `size`, `danger`, `shape` and `tooltipProps` props.\n\n**Used in:** 12 places — the layout breadcrumb sidebar toggle, the observability header, the playground testset drawer and deploy-variant button, the trace drawer accordion panel, the annotate and add-to-testset buttons, the EE audit-log filters, the annotation scenario list, and both playground execution-row layouts.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label="default + tooltip + icon">
                <EnhancedButton label="Add" icon={ICON} tooltipProps={{title: "Add a new item"}} />
            </Row>
            <Row label="primary → default variant">
                <EnhancedButton
                    type="primary"
                    label="Save"
                    tooltipProps={{title: "Save changes"}}
                />
            </Row>
            <Row label="text → ghost variant">
                <EnhancedButton type="text" label="More" tooltipProps={{title: "More options"}} />
            </Row>
            <Row label="danger">
                <EnhancedButton danger label="Delete" tooltipProps={{title: "Delete"}} />
            </Row>
            <Row label="small">
                <EnhancedButton size="small" label="Small" tooltipProps={{title: "Small"}} />
            </Row>
            <Row label="large">
                <EnhancedButton size="large" label="Large" tooltipProps={{title: "Large"}} />
            </Row>
            <Row label="icon-only (circle)">
                <EnhancedButton shape="circle" icon={ICON} tooltipProps={{title: "Add"}} />
            </Row>
            <Row label="no tooltip (bare button)">
                <EnhancedButton label="Add" icon={ICON} />
            </Row>
        </div>
    ),
}
