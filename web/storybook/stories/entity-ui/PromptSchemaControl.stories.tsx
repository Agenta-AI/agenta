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

// PromptSchemaControl — the prompt object surface (messages + tools + action bar).
// The messages/tools bodies are `ChatMessageList` / `ToolItemControl` (other chunks); this
// file's own surface is the ACTION BAR (`Button`, `Select`) plus the legacy template-format
// `Alert`, which the Variants story lists.
const meta = {
    title: "@agenta/entity-ui/DrillIn/PromptSchemaControl",
    component: PromptSchemaControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Prompt object control: the messages list, the tools list and an action bar (add message, output type, prompt syntax). A legacy template format shows a one-way switch banner.",
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

const TEMPLATE_FORMAT_OPTIONS = [
    {label: "Prompt Syntax: Mustache", value: "mustache"},
    {label: "Prompt Syntax: Jinja2", value: "jinja2"},
    {label: "Prompt Syntax: Curly", value: "curly"},
]

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

/** The banner body. */
const bannerMessage = (chipClass: string) => (
    <span className="text-[12px]">
        Switching from <code className={chipClass}>curly</code> is permanent — once you commit, you
        won&apos;t be able to switch back. Discard the draft to revert.
    </span>
)

export const Variants: Story = {
    args: {schema: PROMPT_SCHEMA, label: "Prompt", value: {}, onChange: noop},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="add-message button">
                <Button variant="outline" size="sm">
                    <Plus size={14} />
                    Message
                </Button>
            </Row>
            <Row label="template-format select">
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
            </Row>
            <Row label="legacy-format banner">
                <Alert
                    type="info"
                    showIcon
                    icon={<Info size={14} className="!size-3.5" />}
                    className="!py-1 !px-2 !rounded-md"
                    message={bannerMessage("font-mono text-[11px] bg-chip px-1 rounded")}
                />
            </Row>
        </div>
    ),
}
