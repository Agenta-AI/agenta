import {SchemasConfigControl} from "@agenta/entity-ui/drill-in"
import {CollapseToggleButton} from "@agenta/ui/components/presentational"
import {Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {CopySimple} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// SchemasConfigControl — the workflow `data.schemas` editor (parameters / inputs / outputs),
// three collapsed JSON cards. The Variants story lists the card header pieces: title, copy
// button with tooltip, and CollapseToggleButton.
const meta = {
    title: "@agenta/entity-ui/DrillIn/SchemasConfigControl",
    component: SchemasConfigControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Three JSON-schema editors (parameters / inputs / outputs) with tool-card chrome.",
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

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

/** Card header with the visibility classes dropped so the copy button shows outside its
 *  `group-hover/schema` parent. */
function CardHeader() {
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

export const Variants: Story = {
    args: {value: SCHEMAS, onChange: () => undefined},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="card header">
                <CardHeader />
            </Row>
            <Row label="field label (strong)">
                <span className="text-sm font-semibold pl-2 text-colorText">Outputs</span>
            </Row>
            <Row label="copy button (icon-only)">
                <Button variant="ghost" size="icon-sm" aria-label="Copy" onClick={() => undefined}>
                    <CopySimple size={14} />
                </Button>
            </Row>
        </div>
    ),
}
