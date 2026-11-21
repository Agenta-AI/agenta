import {SectionRail, type SectionRailItem} from "@agenta/entity-ui/drawers/shared"
import type {Meta, StoryObj} from "@storybook/nextjs"

// SectionRail — the drawer's `[left rail | right content]` section-body layout.
const meta = {
    title: "@agenta/entity-ui/Drawers/SectionRail",
    component: SectionRail,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component: "A narrow vertical toggle list beside a content panel.",
            },
        },
    },
} satisfies Meta<typeof SectionRail>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined
const body = <div className="text-xs text-colorText">Section content</div>

const basicItems: SectionRailItem[] = [
    {value: "schema", label: "Schema"},
    {value: "config", label: "Configuration"},
]
const countItems: SectionRailItem[] = [
    {value: "schema", label: "Schema", count: 6},
    {value: "config", label: "Configuration", count: 2},
]
const statusItems: SectionRailItem[] = [
    {value: "model", label: "Model", status: "warning"},
    {value: "keys", label: "Provider keys", status: "invalid"},
    {value: "other", label: "Other"},
]

const Row = ({
    label,
    items,
    value,
    disabled,
}: {
    label: string
    items: SectionRailItem[]
    value: string
    disabled?: boolean
}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[340px]">
            <SectionRail items={items} value={value} onChange={noop} disabled={disabled}>
                {body}
            </SectionRail>
        </div>
    </div>
)

export const Variants: Story = {
    args: {items: basicItems, value: "schema", onChange: noop, children: body},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="basic (first active)" items={basicItems} value="schema" />
            <Row label="with counts" items={countItems} value="config" />
            <Row label="status dots" items={statusItems} value="model" />
            <Row label="disabled" items={basicItems} value="schema" disabled />
        </div>
    ),
}
