import {Accordion, AccordionItem, AccordionTrigger, AccordionContent} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Collapse as AntCollapse} from "antd"

// Phase-0 parity story: the REAL antd Collapse (default LINE/bordered) behind the app theme,
// side by side with the @agenta/ui Radix re-skin. antd `items={[{key,label,children}]}` +
// `defaultActiveKey`/`bordered`/`ghost` maps to <Accordion type collapsible defaultValue> +
// <AccordionItem value><AccordionTrigger/><AccordionContent/>.
const meta = {
    title: "@agenta/ui/Primitives/Display/Collapse",
    component: AntCollapse,
    subcomponents: {
        "Accordion (@agenta/ui)": Accordion,
        AccordionItem,
        AccordionTrigger,
        AccordionContent,
    },
    parameters: {
        docs: {
            description: {
                component:
                    "antd `Collapse` (interactive reference) shown beside the `@agenta/ui` Accordion (Radix) that replaces it. See the subcomponent tables below for the agenta props.\n\n**Used in:** nowhere — the `@agenta/ui` Accordion has zero call-sites. Collapsible sections in the app use `ConfigAccordionSection` and `HeightCollapse` instead.",
            },
        },
    },
} satisfies Meta<typeof AntCollapse>

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

const antItems = (panels: Panel[]) =>
    panels.map((p) => ({
        key: p.key,
        label: p.label,
        children: <div className="text-field-md">{p.body}</div>,
    }))

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

// `.grid` Row: [label | antd cell | agenta cell]. The VRT pairs the collapse group in each
// cell so the group border/radius, header bg, dividers, and open content are compared.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {/* data-vrt-subject: a collapse group has many headers — crop the whole group */}
            <div data-vrt-subject>{a}</div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject>{s}</div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[960px] flex-col">
            <Row
                label="bordered · panel 1 open"
                a={<AntCollapse defaultActiveKey={["1"]} items={antItems(generalPanels)} />}
                s={<Agenta defaultValue="1" panels={generalPanels} />}
            />
            <Row
                label="bordered · all closed"
                a={<AntCollapse items={antItems(accountPanels)} />}
                s={<Agenta panels={accountPanels} />}
            />
            <Row
                label="ghost · panel 1 open"
                a={<AntCollapse ghost defaultActiveKey={["1"]} items={antItems(workspacePanels)} />}
                s={<Agenta variant="ghost" defaultValue="1" panels={workspacePanels} />}
            />
        </div>
    ),
}

// Interaction states rendered STATICALLY via storybook-addon-pseudo-states: each cell is
// wrapped in `pseudo-<state>-all`, forcing the pseudo-class on the header trigger inside —
// hover/focus-visible measurable with getComputedStyle, forced identically on antd + agenta.
const StateRow = ({
    label,
    pseudo,
    antd,
    shad,
}: {
    label: string
    pseudo: string
    antd: React.ReactNode
    shad: React.ReactNode
}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={pseudo} data-side="antd">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject>{antd}</div>
        </div>
        <div className={pseudo} data-side="agenta">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject>{shad}</div>
        </div>
    </div>
)

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[960px] flex-col">
            <StateRow
                label="header · hover"
                pseudo="pseudo-hover-all"
                antd={<AntCollapse items={antItems(accountPanels)} />}
                shad={<Agenta panels={accountPanels} />}
            />
            <StateRow
                label="header · focus-visible"
                pseudo="pseudo-focus-visible-all"
                antd={<AntCollapse items={antItems(workspacePanels)} />}
                shad={<Agenta panels={workspacePanels} />}
            />
        </div>
    ),
}
