import {CollapseToggleButton} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Buttons/CollapseToggleButton",
    component: CollapseToggleButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Facade over the @agenta/ui Button (variant="ghost") wrapped in a Tooltip, with caret icons and Collapse/Expand labels.\n\n**Used in:** 6 places — the agent config drill-in controls (code, schemas and tool items in `@agenta/entity-ui/DrillInView/SchemaControls`), the chat message list, and the playground turn header plus single-layout execution row (via the `@agenta/playground-ui` re-export shim). The component takes no icon prop and no call-site overrides `size`/`iconSize`, so the `CaretLineUp`/`CaretLineDown` carets shown here are exactly what ships.',
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
        <div className="flex max-w-[480px] flex-col">
            <Row label="expanded (Collapse)">
                <CollapseToggleButton collapsed={false} onToggle={() => {}} />
            </Row>
            <Row label="collapsed (Expand)">
                <CollapseToggleButton collapsed onToggle={() => {}} />
            </Row>
            <Row label="disabled">
                <CollapseToggleButton collapsed={false} disabled onToggle={() => {}} />
            </Row>
        </div>
    ),
}
