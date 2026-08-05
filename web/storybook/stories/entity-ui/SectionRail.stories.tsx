import {SectionRail, type SectionRailItem} from "@agenta/entity-ui/drawers/shared"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton} from "antd"
import clsx from "clsx"

// SectionRail — the drawer's `[left rail | right content]` section-body layout. The antd cell
// replays the pre-migration rail (antd `Button type="text"` with `!`-forced classes) verbatim
// from feat/storybook-data-seam; the agenta cell is the migrated component (ghost Button).
const meta = {
    title: "@agenta/entity-ui/Drawers/SectionRail",
    component: SectionRail,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A narrow vertical toggle list beside a content panel. antd text `Button` → `@agenta/ui` ghost `Button` (className overrides replace the `!` forced styles).",
            },
        },
    },
} satisfies Meta<typeof SectionRail>

export default meta
type Story = StoryObj<typeof meta>

/** The pre-migration SectionRail, verbatim (antd text Button rail). */
const AntdSectionRail = ({
    items,
    value,
    onChange,
    railWidth = "w-[116px]",
    disabled = false,
    fill = false,
    children,
}: {
    items: SectionRailItem[]
    value: string
    onChange: (value: string) => void
    railWidth?: string
    disabled?: boolean
    fill?: boolean
    children: React.ReactNode
}) => (
    <div className={clsx("flex gap-3", fill && "min-h-0 flex-1")}>
        <div className={`flex ${railWidth} shrink-0 flex-col gap-0.5`}>
            {items.map((item) => {
                const active = item.value === value
                return (
                    <AntButton
                        key={item.value}
                        type="text"
                        block
                        disabled={disabled}
                        onClick={() => onChange(item.value)}
                        className={`!h-8 !rounded-md !px-2.5 !text-xs transition-colors ${
                            item.count != null || item.status
                                ? "!flex !items-center !justify-between"
                                : "!justify-start"
                        } ${
                            active
                                ? "!bg-[var(--ag-colorFillSecondary)] !font-semibold !text-[var(--ag-colorText)]"
                                : "!text-[var(--ag-colorTextSecondary)] hover:!bg-[var(--ag-colorFillTertiary)] hover:!text-[var(--ag-colorText)]"
                        }`}
                    >
                        <span className="truncate">{item.label}</span>
                        {item.status ? (
                            <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    item.status === "invalid"
                                        ? "bg-[var(--ag-colorError)]"
                                        : "bg-[var(--ag-colorWarning)]"
                                }`}
                            />
                        ) : item.count != null ? (
                            <span className="text-[10px] opacity-70">{item.count}</span>
                        ) : null}
                    </AntButton>
                )
            })}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 border-0 border-l border-solid border-[var(--ag-colorBorder)] pl-4">
            {children}
        </div>
    </div>
)

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
    <div className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[340px]" data-vrt-subject>
                <AntdSectionRail items={items} value={value} onChange={noop} disabled={disabled}>
                    {body}
                </AntdSectionRail>
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[340px]" data-vrt-subject>
                <SectionRail items={items} value={value} onChange={noop} disabled={disabled}>
                    {body}
                </SectionRail>
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {items: basicItems, value: "schema", onChange: noop, children: body},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row label="basic (first active)" items={basicItems} value="schema" />
            <Row label="with counts" items={countItems} value="config" />
            <Row label="status dots" items={statusItems} value="model" />
            <Row label="disabled" items={basicItems} value="schema" disabled />
        </div>
    ),
}
