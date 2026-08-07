import {SchemasConfigControl} from "@agenta/entity-ui/drill-in"
import {CollapseToggleButton} from "@agenta/ui/components/presentational"
import {Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {CopySimple} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Tooltip as AntTooltip, Typography} from "antd"

// SchemasConfigControl — the workflow `data.schemas` editor (parameters / inputs / outputs),
// three collapsed JSON cards. antd surface: the card HEADER only — `Typography.Text strong`,
// a `Tooltip`-wrapped icon `Button` (copy) and the already-migrated CollapseToggleButton.
const meta = {
    title: "@agenta/entity-ui/DrillIn/SchemasConfigControl",
    component: SchemasConfigControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Three JSON-schema editors with tool-card chrome. antd `Typography.Text strong` → `<span className="font-semibold">`, antd `Tooltip` → Radix `Tooltip`, antd icon `Button type="text" size="small"` → `@agenta/ui` `Button variant="ghost" size="icon-sm"` (icon-only maps to the SQUARE icon ramp, never `sm`).',
            },
        },
    },
} satisfies Meta<typeof SchemasConfigControl>

export default meta
type Story = StoryObj<typeof meta>

const SCHEMAS = {
    parameters: {
        type: "object",
        properties: {temperature: {type: "number"}, model: {type: "string"}},
    },
    inputs: {type: "object", required: ["query"], properties: {query: {type: "string"}}},
    outputs: {type: "object", properties: {answer: {type: "string"}}},
}

/** All three cards, collapsed (the default). */
export const Default: Story = {args: {value: SCHEMAS, onChange: () => undefined}}

/** No schemas yet — every card falls back to `{}`. */
export const EmptyValue: Story = {args: {value: null, onChange: () => undefined}}

/** Read-only (`state="readOnly"` on every editor). */
export const Disabled: Story = {args: {value: SCHEMAS, disabled: true, onChange: () => undefined}}

// ---------------------------------------------------------------------------
// Parity: the card header (the file's whole antd surface)
// ---------------------------------------------------------------------------

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

/** Pre-migration header, verbatim (antd Typography + Tooltip + icon Button). */
function AntdHeader() {
    return (
        <div className="w-full flex items-start justify-between py-1">
            <Typography.Text strong className="text-sm pl-2">
                Parameters
            </Typography.Text>
            <div className="flex items-center gap-1 shrink-0">
                <AntTooltip title="Copy">
                    <AntButton
                        icon={<CopySimple size={14} />}
                        type="text"
                        size="small"
                        onClick={() => undefined}
                    />
                </AntTooltip>
                <CollapseToggleButton collapsed onToggle={() => undefined} className="opacity-50" />
            </div>
        </div>
    )
}

/** Migrated header, verbatim from SchemasConfigControl (visibility classes dropped so the
 *  copy button is measurable outside its `group-hover/schema` parent). */
function AgentaHeader() {
    return (
        <div className="w-full flex items-start justify-between py-1">
            <span className="text-sm font-semibold pl-2 text-colorText">Parameters</span>
            <div className="flex items-center gap-1 shrink-0">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Copy"
                                onClick={() => undefined}
                            >
                                <CopySimple size={14} />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <CollapseToggleButton collapsed onToggle={() => undefined} className="opacity-50" />
            </div>
        </div>
    )
}

export const AntdVsAgenta: Story = {
    args: {value: SCHEMAS, onChange: () => undefined},
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row label="card header" a={<AntdHeader />} s={<AgentaHeader />} />
            <Row
                label="field label (strong)"
                a={
                    <Typography.Text strong className="text-sm pl-2">
                        Outputs
                    </Typography.Text>
                }
                s={<span className="text-sm font-semibold pl-2 text-colorText">Outputs</span>}
            />
            <Row
                label="copy button (icon-only)"
                expected="accepted deviation (GOTCHAS §Native-element parity): antd's `span.ant-btn-icon` sits the glyph 0.75px above true centre; we centre the bare svg. Icon-only crops read highest because the glyph is the only ink in a 24x24 box. Geometry otherwise identical (24x24, p-0, radius 6px)."
                a={
                    <AntButton
                        icon={<CopySimple size={14} />}
                        type="text"
                        size="small"
                        onClick={() => undefined}
                    />
                }
                s={
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Copy"
                        onClick={() => undefined}
                    >
                        <CopySimple size={14} />
                    </Button>
                }
            />
        </div>
    ),
}
