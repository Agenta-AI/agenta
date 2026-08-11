import {useState} from "react"

import {
    Alert,
    Button,
    Field,
    Input,
    InputNumber,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {Info, Plus, Trash} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {
    Alert as AntAlert,
    Button as AntButton,
    Input as AntInput,
    InputNumber as AntInputNumber,
    Select as AntSelect,
    Switch as AntSwitch,
    Tooltip as AntTooltip,
    Typography,
} from "antd"

// Imported from source: the DrillInView barrel re-exports the component but not the shared
// mode atom the section header toggles, which the AdvancedMode data-seam story has to seed.
import {
    FeedbackConfigurationControl,
    feedbackConfigModeAtomFamily,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/FeedbackConfigurationControl"

// FeedbackConfigurationControl — the evaluator feedback-format form (response format, numeric
// range, categories, include-reasoning) that generates the JSON schema, plus an advanced raw-JSON
// mode driven by a shared atom.
//
// Migration: antd `Select size="small"` → `@agenta/ui` `Select` + `SelectTrigger size="sm"`,
// antd `Alert` → `Alert` (NOTE antd v6 renamed `message` → `title`; ours is still `message`),
// antd `InputNumber`/`Input`/`Switch`/`Tooltip` → the `@agenta/ui` equivalents,
// antd `Button icon type="dashed"/"text" danger` → `Button` with the icon as a child,
// `Typography.Text` → plain `<span>`. The dead `Modal.useModal()` contextHolder (no modal API was
// ever called) was removed rather than ported.
const meta = {
    title: "@agenta/entity-ui/DrillIn/FeedbackConfigurationControl",
    component: FeedbackConfigurationControl,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Evaluator feedback format: Boolean / Continuous (min+max) / Categorical (name+description rows), plus an include-reasoning switch. `advanced` mode (a shared atom the section header toggles) swaps the form for a raw JSON-schema editor.",
            },
        },
    },
} satisfies Meta<typeof FeedbackConfigurationControl>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const booleanSchema = {
    name: "schema",
    schema: {
        title: "extract",
        description: "Extract information from the user's response.",
        type: "object",
        properties: {score: {type: "boolean", description: "The grade results"}},
        required: ["score"],
        additionalProperties: false,
    },
    strict: true,
}

const continuousSchema = {
    name: "schema",
    schema: {
        title: "extract",
        description: "Extract information from the user's response.",
        type: "object",
        properties: {
            score: {type: "number", description: "The grade results", minimum: 1, maximum: 5},
            reasoning: {type: "string", description: "Reasoning for the score"},
        },
        required: ["score", "reasoning"],
        additionalProperties: false,
    },
    strict: true,
}

const categoricalSchema = {
    name: "schema",
    schema: {
        title: "extract",
        description: "Extract information from the user's response.",
        type: "object",
        properties: {
            score: {
                type: "string",
                description: "The grade results",
                enum: ["good", "bad", "unclear"],
            },
        },
        required: ["score"],
        additionalProperties: false,
    },
    strict: true,
}

const Live = ({
    initial,
    ...rest
}: {initial: unknown} & Partial<React.ComponentProps<typeof FeedbackConfigurationControl>>) => {
    const [value, setValue] = useState<unknown>(initial)
    return (
        <div className="max-w-[420px]">
            <FeedbackConfigurationControl value={value} onChange={setValue} {...rest} />
        </div>
    )
}

/** Boolean format — the info Alert, no numeric or category rows. */
export const BooleanFormat: Story = {
    args: {value: booleanSchema, onChange: noop},
    render: () => <Live initial={booleanSchema} />,
}

/** Continuous format — Minimum/Maximum InputNumbers and reasoning enabled. */
export const ContinuousFormat: Story = {
    args: {value: continuousSchema, onChange: noop},
    render: () => <Live initial={continuousSchema} />,
}

/** Categorical format — the Add / remove category rows. */
export const CategoricalFormat: Story = {
    args: {value: categoricalSchema, onChange: noop},
    render: () => <Live initial={categoricalSchema} />,
}

/** Disabled (a committed revision) — every leaf takes the disabled skin. */
export const Disabled: Story = {
    args: {value: categoricalSchema, onChange: noop, disabled: true},
    render: () => <Live initial={categoricalSchema} disabled />,
}

/**
 * Advanced mode — data-seam story: `feedbackConfigModeAtomFamily(entityId)` is the shared atom
 * the section header flips, so the story seeds it instead of mocking anything. The id is unique
 * to this story so the atomFamily entry cannot collide with another story's.
 */
export const AdvancedMode: Story = {
    args: {value: booleanSchema, onChange: noop, entityId: "feedback-advanced-story"},
    parameters: {
        agenta: {
            atoms: [[feedbackConfigModeAtomFamily("feedback-advanced-story"), "advanced"]],
        },
    },
    render: () => <Live initial={booleanSchema} entityId="feedback-advanced-story" />,
}

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
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
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

const FORMAT_OPTIONS = [
    {label: "Boolean (True/False)", value: "boolean"},
    {label: "Continuous (Numeric Range)", value: "continuous"},
    {label: "Categorical (Predefined Options)", value: "categorical"},
]

const BOOLEAN_HINT =
    "The evaluator will provide a true (1) or false (0) response based on the feedback criteria."

/** Pre-migration antd basic-mode form (feat/storybook-data-seam). */
const AntdBasicForm = () => (
    <div>
        <div className="mb-4">
            <Field label="Response Format" tooltip="Choose the format for your evaluation results">
                <AntSelect
                    style={{width: "100%"}}
                    value="categorical"
                    size="small"
                    options={FORMAT_OPTIONS}
                />
            </Field>
        </div>
        <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                    <Typography.Text className="text-xs font-medium">Categories</Typography.Text>
                    <AntTooltip title="Define the possible category values for the evaluation">
                        <Info size={12} className="cursor-help text-gray-400" aria-hidden="true" />
                    </AntTooltip>
                </div>
                <AntButton size="small" type="dashed" icon={<Plus size={14} />}>
                    Add
                </AntButton>
            </div>
            <div className="flex flex-col gap-2">
                {/* The control derives its rows from the schema's `enum`, and the parser has no
                    per-category description to recover — so the antd half mirrors that exactly:
                    three named rows with empty (placeholder) descriptions. */}
                {["good", "bad", "unclear"].map((name) => (
                    <div key={name} className="flex items-start gap-2">
                        <AntInput placeholder="Name" value={name} className="flex-1" />
                        <AntInput placeholder="Description" value="" className="flex-[2]" />
                        <AntButton type="text" danger icon={<Trash size={14} />} />
                    </div>
                ))}
            </div>
        </div>
        <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
                <Typography.Text className="text-xs font-medium">Include reasoning</Typography.Text>
                <AntTooltip title="When enabled, the evaluator will also provide a comment explaining the score">
                    <Info size={12} className="cursor-help text-gray-400" aria-hidden="true" />
                </AntTooltip>
            </div>
            <AntSwitch size="small" className="flex-shrink-0" />
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {value: categoricalSchema, onChange: noop},
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row
                label="format select (sm)"
                a={
                    <Field
                        label="Response Format"
                        tooltip="Choose the format for your evaluation results"
                    >
                        <AntSelect
                            style={{width: "100%"}}
                            value="boolean"
                            size="small"
                            options={FORMAT_OPTIONS}
                        />
                    </Field>
                }
                s={
                    <Field
                        label="Response Format"
                        tooltip="Choose the format for your evaluation results"
                    >
                        <Select value="boolean">
                            {/* Field's htmlFor lands on the Radix Root, not this button. */}
                            <SelectTrigger
                                size="sm"
                                className="w-full"
                                aria-label="Response Format"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {FORMAT_OPTIONS.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                        {o.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                }
            />
            <Row
                label="boolean info alert"
                expected="antd v6 renamed Alert `message` → `title`; the @agenta/ui Alert still takes `message`. Same rendered text."
                a={<AntAlert title={BOOLEAN_HINT} type="info" showIcon />}
                s={<Alert message={BOOLEAN_HINT} type="info" showIcon />}
            />
            <Row
                label="min / max"
                a={
                    <div className="flex flex-col gap-3">
                        <Field
                            label="Minimum"
                            tooltip="The minimum value for the numeric score range"
                        >
                            <AntInputNumber style={{width: "100%"}} value={1} />
                        </Field>
                        <Field
                            label="Maximum"
                            tooltip="The maximum value for the numeric score range"
                        >
                            <AntInputNumber style={{width: "100%"}} value={5} />
                        </Field>
                    </div>
                }
                s={
                    <div className="flex flex-col gap-3">
                        <Field
                            label="Minimum"
                            tooltip="The minimum value for the numeric score range"
                        >
                            <InputNumber className="w-full" value={1} onChange={noop} />
                        </Field>
                        <Field
                            label="Maximum"
                            tooltip="The maximum value for the numeric score range"
                        >
                            <InputNumber className="w-full" value={5} onChange={noop} />
                        </Field>
                    </div>
                }
            />
            <Row
                label="category row"
                a={
                    <div className="flex items-start gap-2">
                        <AntInput placeholder="Name" value="good" className="flex-1" />
                        <AntInput
                            placeholder="Description"
                            value="The response is good"
                            className="flex-[2]"
                        />
                        <AntButton type="text" danger icon={<Trash size={14} />} />
                    </div>
                }
                s={
                    <div className="flex items-start gap-2">
                        <Input
                            placeholder="Name"
                            aria-label="Category 1 name"
                            value="good"
                            onChange={noop}
                            className="flex-1"
                        />
                        <Input
                            placeholder="Description"
                            aria-label="Category 1 description"
                            value="The response is good"
                            onChange={noop}
                            className="flex-[2]"
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remove category 1"
                            className="text-error hover:bg-error-bg hover:text-error-hover"
                        >
                            <Trash size={14} />
                        </Button>
                    </div>
                }
            />
            <Row
                label="add category button"
                expected="antd wraps a button icon in a 15.5px inline text box, landing the glyph ~0.75px above true centre; we centre the bare svg. Documented permanent residue on every icon-in-button pair (GOTCHAS §Native-element parity)."
                a={
                    <div className="flex">
                        <AntButton size="small" type="dashed" icon={<Plus size={14} />}>
                            Add
                        </AntButton>
                    </div>
                }
                s={
                    <div className="flex">
                        <Button size="sm" variant="dashed">
                            <Plus size={14} />
                            Add
                        </Button>
                    </div>
                }
            />
            <Row
                label="include reasoning"
                a={
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-1">
                            <Typography.Text className="text-xs font-medium">
                                Include reasoning
                            </Typography.Text>
                            <AntTooltip title="When enabled, the evaluator will also provide a comment explaining the score">
                                <Info
                                    size={12}
                                    className="cursor-help text-gray-400"
                                    aria-hidden="true"
                                />
                            </AntTooltip>
                        </div>
                        <AntSwitch checked size="small" className="flex-shrink-0" />
                    </div>
                }
                s={
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-1">
                            <span className="text-xs font-medium" id="fb-reasoning-parity">
                                Include reasoning
                            </span>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Info size={12} className="cursor-help text-gray-400" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        When enabled, the evaluator will also provide a comment
                                        explaining the score
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        <Switch
                            checked
                            size="sm"
                            aria-labelledby="fb-reasoning-parity"
                            className="flex-shrink-0"
                        />
                    </div>
                }
            />
            <Row
                label="whole form (categorical)"
                a={<AntdBasicForm />}
                s={
                    <FeedbackConfigurationControl
                        value={categoricalSchema}
                        onChange={noop}
                        entityId="feedback-parity-story"
                    />
                }
            />
        </div>
    ),
}
