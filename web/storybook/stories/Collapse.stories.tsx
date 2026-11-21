import {Accordion, AccordionItem, AccordionTrigger, AccordionContent} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Display/Collapse",
    component: Accordion,
    args: {type: "single", collapsible: true},
    subcomponents: {
        AccordionItem,
        AccordionTrigger,
        AccordionContent,
    },
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Accordion (Radix) for collapsible panels, in `bordered` or `ghost` variants. Compose `Accordion` > `AccordionItem` > `AccordionTrigger` + `AccordionContent`. Prop tables for each part are below.\n\n**Used in:** nowhere — the `@agenta/ui` Accordion has zero call-sites. Collapsible sections in the app use `ConfigAccordionSection` and `HeightCollapse` instead.",
            },
        },
    },
} satisfies Meta<typeof Accordion>

export default meta
type Story = StoryObj<typeof meta>

// Distinct labels PER GROUP: Radix AccordionContent gets role="region" auto-labelled by its
// trigger, so reusing the same labels across groups trips axe `landmark-unique` (duplicate
// region names). Real usage has distinct labels — mirror that per group.
interface Panel {
    key: string
    label: string
    body: string
}

const Agenta = ({
    variant,
    defaultValue,
    panels,
}: {
    variant?: "bordered" | "ghost"
    defaultValue?: string
    panels: Panel[]
}) => (
    <Accordion type="single" collapsible defaultValue={defaultValue} variant={variant}>
        {panels.map((p) => (
            <AccordionItem key={p.key} value={p.key}>
                <AccordionTrigger>{p.label}</AccordionTrigger>
                <AccordionContent>{p.body}</AccordionContent>
            </AccordionItem>
        ))}
    </Accordion>
)

const generalPanels: Panel[] = [
    {key: "1", label: "General", body: "General settings content"},
    {key: "2", label: "Notifications", body: "Notification settings content"},
    {key: "3", label: "Privacy", body: "Privacy settings content"},
]
const accountPanels: Panel[] = [
    {key: "1", label: "Profile", body: "Profile details content"},
    {key: "2", label: "Security", body: "Security settings content"},
    {key: "3", label: "Billing", body: "Billing details content"},
]
const workspacePanels: Panel[] = [
    {key: "1", label: "Members", body: "Members list content"},
    {key: "2", label: "Roles", body: "Roles configuration content"},
    {key: "3", label: "Integrations", body: "Integrations content"},
]

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="bordered · panel 1 open">
                <Agenta defaultValue="1" panels={generalPanels} />
            </Row>
            <Row label="bordered · all closed">
                <Agenta panels={accountPanels} />
            </Row>
            <Row label="ghost · panel 1 open">
                <Agenta variant="ghost" defaultValue="1" panels={workspacePanels} />
            </Row>
        </div>
    ),
}

// Interaction states rendered STATICALLY via storybook-addon-pseudo-states: each cell is
// wrapped in `pseudo-<state>-all`, forcing the pseudo-class on the header trigger inside.
export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <div className="grid grid-cols-[14rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
                <div className="text-xs text-colorTextSecondary">header · hover</div>
                <div className="pseudo-hover-all">
                    <Agenta panels={accountPanels} />
                </div>
            </div>
            <div className="grid grid-cols-[14rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
                <div className="text-xs text-colorTextSecondary">header · focus-visible</div>
                <div className="pseudo-focus-visible-all">
                    <Agenta panels={workspacePanels} />
                </div>
            </div>
        </div>
    ),
}
