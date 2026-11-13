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

// Imported from source: the DrillInView barrel re-exports the component but not the shared
// mode atom the section header toggles, which the AdvancedMode data-seam story has to seed.
import {
    FeedbackConfigurationControl,
    feedbackConfigModeAtomFamily,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/FeedbackConfigurationControl"

// FeedbackConfigurationControl — the evaluator feedback-format form (response format, numeric
// range, categories, include-reasoning) that generates the JSON schema, plus an advanced raw-JSON
// mode driven by a shared atom.
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

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <div className="flex-1">{children}</div>
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

export const Variants: Story = {
    args: {value: categoricalSchema, onChange: noop},
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row label="format select (sm)">
                <Field
                    label="Response Format"
                    tooltip="Choose the format for your evaluation results"
                >
                    <Select value="boolean">
                        {/* Field's htmlFor lands on the Radix Root, not this button. */}
                        <SelectTrigger size="sm" className="w-full" aria-label="Response Format">
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
            </Row>
            <Row label="boolean info alert">
                <Alert message={BOOLEAN_HINT} type="info" showIcon />
            </Row>
            <Row label="min / max">
                <div className="flex flex-col gap-3">
                    <Field label="Minimum" tooltip="The minimum value for the numeric score range">
                        <InputNumber className="w-full" value={1} onChange={noop} />
                    </Field>
                    <Field label="Maximum" tooltip="The maximum value for the numeric score range">
                        <InputNumber className="w-full" value={5} onChange={noop} />
                    </Field>
                </div>
            </Row>
            <Row label="category row">
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
            </Row>
            <Row label="add category button">
                <div className="flex">
                    <Button size="sm" variant="dashed">
                        <Plus size={14} />
                        Add
                    </Button>
                </div>
            </Row>
            <Row label="include reasoning">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1">
                        <span className="text-xs font-medium" id="fb-reasoning-variants">
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
                        aria-labelledby="fb-reasoning-variants"
                        className="flex-shrink-0"
                    />
                </div>
            </Row>
            <Row label="whole form (categorical)">
                <FeedbackConfigurationControl
                    value={categoricalSchema}
                    onChange={noop}
                    entityId="feedback-variants-story"
                />
            </Row>
        </div>
    ),
}
