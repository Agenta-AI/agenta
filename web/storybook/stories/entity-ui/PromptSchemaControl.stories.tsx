import {PromptSchemaControl} from "@agenta/entity-ui/drill-in"
import {
    Alert,
    Button,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {Info, Plus} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Alert as AntAlert, Button as AntButton, Select as AntSelect} from "antd"

// PromptSchemaControl — the prompt object surface (messages + tools + action bar).
// The messages/tools bodies are `ChatMessageList` / `ToolItemControl` (other chunks); the
// antd this file itself carried was the ACTION BAR (`Button`, `Select`) plus the legacy
// template-format `Alert`, so those three are what the parity grid pairs.
const meta = {
    title: "@agenta/entity-ui/DrillIn/PromptSchemaControl",
    component: PromptSchemaControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Prompt control. antd `Button icon=… size="small"` → `@agenta/ui` `Button variant="outline" size="sm"` with the icon as a CHILD, antd `Select` → the `@agenta/ui` Select composition (`popupMatchSelectWidth={false}` → `w-auto` content, `style={{height:24}}` → `h-control-sm`), antd `Alert` → `@agenta/ui` `Alert` (same API).',
            },
        },
    },
} satisfies Meta<typeof PromptSchemaControl>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const PROMPT_SCHEMA = {
    type: "object",
    "x-parameter": "prompt",
    properties: {
        messages: {
            type: "array",
            items: {
                type: "object",
                properties: {role: {type: "string"}, content: {type: "string"}},
            },
        },
        template_format: {type: "string"},
    },
}

/**
 * The value carries no `messages` key at all → the component renders its fixed-height
 * placeholder (the "schema still resolving" branch a live playground flashes through).
 */
export const NoMessagesField: Story = {
    args: {schema: PROMPT_SCHEMA, label: "Prompt", value: {}, onChange: noop},
}

/** Disabled: the whole action bar (and the migration banner) is suppressed. */
export const Disabled: Story = {
    args: {
        schema: PROMPT_SCHEMA,
        label: "Prompt",
        value: {messages: [{role: "system", content: "Be terse."}], template_format: "mustache"},
        disabled: true,
        onChange: noop,
    },
}

/** Editable: messages list + the action bar (Message button, output type, prompt syntax). */
export const Default: Story = {
    args: {
        schema: PROMPT_SCHEMA,
        label: "Prompt",
        value: {
            messages: [
                {role: "system", content: "You are terse."},
                {role: "user", content: "Summarise {{document}}."},
            ],
            template_format: "mustache",
        },
        variables: ["document"],
        onChange: noop,
    },
}

// ---------------------------------------------------------------------------
// Parity: the action bar + the legacy-format banner
// ---------------------------------------------------------------------------

const TEMPLATE_FORMAT_OPTIONS = [
    {label: "Prompt Syntax: Mustache", value: "mustache"},
    {label: "Prompt Syntax: Jinja2", value: "jinja2"},
    {label: "Prompt Syntax: Curly", value: "curly"},
]

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
        className="grid grid-cols-[14rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3"
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

/** The banner body, shared by both halves apart from the code chip's fill. */
const bannerMessage = (chipClass: string) => (
    <span className="text-[12px]">
        Switching from <code className={chipClass}>curly</code> is permanent — once you commit, you
        won&apos;t be able to switch back. Discard the draft to revert.
    </span>
)

export const AntdVsAgenta: Story = {
    args: {schema: PROMPT_SCHEMA, label: "Prompt", value: {}, onChange: noop},
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row
                label="add-message button"
                expected="accepted deviation (GOTCHAS §Native-element parity): antd wraps a button icon in `span.ant-btn-icon` whose 15.5px inline text box lands the glyph 0.75px ABOVE true centre; we centre the bare svg. Measured identical otherwise — button 89.61x24, gap 8px, svg 14x14, icon dx 8 on both; only dy differs (4.25 antd vs 5.00)."
                a={
                    <AntButton
                        variant="outlined"
                        color="default"
                        size="small"
                        icon={<Plus size={14} />}
                    >
                        Message
                    </AntButton>
                }
                s={
                    <Button variant="outline" size="sm">
                        <Plus size={14} />
                        Message
                    </Button>
                }
            />
            <Row
                label="template-format select"
                a={
                    <AntSelect
                        size="small"
                        value="mustache"
                        options={TEMPLATE_FORMAT_OPTIONS}
                        className="min-w-[130px]"
                        popupMatchSelectWidth={false}
                        style={{height: 24}}
                    />
                }
                s={
                    <Select value="mustache">
                        <SelectTrigger
                            size="sm"
                            aria-label="Prompt syntax"
                            className="h-control-sm w-auto min-w-[130px]"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="w-auto min-w-[var(--radix-select-trigger-width)]">
                            {TEMPLATE_FORMAT_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                }
            />
            <Row
                label="legacy-format banner"
                expected="the inline `curly` code chip moved from the hardcoded light-only hex #e6f4ff to the theme-flipping `bg-chip` token — in dark the old fill was a near-white block behind colorText, i.e. unreadable. Light-mode fill therefore differs by design; every other pixel of the Alert is gated."
                a={
                    <AntAlert
                        type="info"
                        showIcon
                        icon={<Info size={14} />}
                        className="!py-1 !px-2 !rounded-md"
                        message={bannerMessage("font-mono text-[11px] bg-[#e6f4ff] px-1 rounded")}
                    />
                }
                s={
                    <Alert
                        type="info"
                        showIcon
                        icon={<Info size={14} className="!size-3.5" />}
                        className="!py-1 !px-2 !rounded-md"
                        message={bannerMessage("font-mono text-[11px] bg-chip px-1 rounded")}
                    />
                }
            />
        </div>
    ),
}
