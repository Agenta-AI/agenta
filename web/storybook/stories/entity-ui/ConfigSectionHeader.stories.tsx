import {useFieldSlots} from "@agenta/entity-ui/drill-in"
import type {FieldHeaderSlotProps} from "@agenta/ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {noop} from "./playgroundConfigSectionFixtures"

// ConfigSectionHeader — the top-level section header `useFieldSlots` renders in the drill-in:
// the collapse caret + label, plus one of three trailing clusters — the prompt's refine button
// and model popover trigger, the code section's runtime picker, or the feedback-config
// Basic/Advanced toggle.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ConfigSectionHeader",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Drill-in section header cluster: collapse caret + label, with the prompt's refine button and model popover trigger, the code runtime picker, or the feedback Basic/Advanced toggle.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

type Variant = "prompt" | "code" | "feedback"

const PROMPT_MODEL_INFO = {
    modelSchema: null,
    modelOptions: [],
    currentModel: "gpt-4o",
    promptValue: {messages: []},
    promptSchemaProps: {},
    llmConfigValue: {model: "gpt-4o"},
    llmConfigProps: {},
    isRootLevel: false,
}

function AgentaConfigSectionHeader({
    variant,
    codeRuntime,
    feedbackMode = "basic",
    disabled = false,
    collapsed = false,
}: {
    variant: Variant
    codeRuntime?: string
    feedbackMode?: "basic" | "advanced"
    disabled?: boolean
    collapsed?: boolean
}) {
    const fieldKey =
        variant === "prompt" ? "prompt" : variant === "code" ? "code" : "feedback_config"
    const slots = useFieldSlots({
        activeData: null,
        codeRuntime,
        collapsedSections: collapsed ? {[fieldKey]: true} : {},
        configurePopoverContent: null,
        disabled,
        feedbackMode,
        handleConfigureOpenChange: noop,
        handleRuntimeChange: noop,
        isModelConfigOpen: false,
        isPresentSiblingGroup: (key: string): key is "code" => key === "code",
        onRefinePrompt: variant === "prompt" ? noop : undefined,
        parameters: {
            prompt: {messages: [{role: "system", content: "hi"}]},
            feedback_config: {},
        },
        promptModelInfo: variant === "prompt" ? PROMPT_MODEL_INFO : null,
        schema: null,
        setFeedbackMode: noop,
        siblingGroups: {code: {script: "", runtime: codeRuntime}},
        stickyHeaderTop: 0,
        toggleSection: noop,
    })

    const props = {
        field: {key: fieldKey, name: fieldKey, value: {}, expandable: true},
        path: [fieldKey],
        entity: null,
        isCollapsed: collapsed,
        onToggleCollapse: noop,
        canCollapse: true,
        isDirty: false,
        defaultRender: () => null,
    } satisfies FieldHeaderSlotProps

    return <>{slots.fieldHeader(props)}</>
}

export const Prompt: Story = {
    render: () => <AgentaConfigSectionHeader variant="prompt" />,
}

export const Code: Story = {
    render: () => <AgentaConfigSectionHeader variant="code" codeRuntime="python" />,
}

export const Feedback: Story = {
    render: () => <AgentaConfigSectionHeader variant="feedback" />,
}

// ---------------------------------------------------------------------------

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[380px]">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row label="prompt">
                <AgentaConfigSectionHeader variant="prompt" />
            </Row>
            <Row label="prompt · collapsed">
                <AgentaConfigSectionHeader variant="prompt" collapsed />
            </Row>
            <Row label="code · runtime">
                <AgentaConfigSectionHeader variant="code" codeRuntime="python" />
            </Row>
            <Row label="code · no runtime">
                <AgentaConfigSectionHeader variant="code" />
            </Row>
            <Row label="feedback · basic">
                <AgentaConfigSectionHeader variant="feedback" />
            </Row>
            <Row label="feedback · advanced">
                <AgentaConfigSectionHeader variant="feedback" feedbackMode="advanced" />
            </Row>
        </div>
    ),
}
