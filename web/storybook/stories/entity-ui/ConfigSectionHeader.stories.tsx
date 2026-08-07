import {useFieldSlots} from "@agenta/entity-ui/drill-in"
import type {FieldHeaderSlotProps} from "@agenta/ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {AntdConfigSectionHeader} from "./playgroundConfigSectionAntd"
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
                    "Drill-in section header cluster. antd Tooltip → @agenta/ui Tooltip (+ TooltipProvider); antd Popover(trigger/placement/arrow/overlayInnerStyle) → Popover + PopoverTrigger asChild + PopoverContent side/align/p-0; antd Dropdown(menu.items/selectedKeys) → DropdownMenu JSX (selected row = controlItemBgActive + text-primary); antd Buttons → @agenta/ui Button (icon-only = size=icon-sm).",
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
        className="grid grid-cols-[9rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[380px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[380px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row
                label="prompt"
                a={
                    <AntdConfigSectionHeader
                        label="Prompt"
                        variant="prompt"
                        currentModel="gpt-4o"
                    />
                }
                s={<AgentaConfigSectionHeader variant="prompt" />}
            />
            <Row
                label="prompt · collapsed"
                a={
                    <AntdConfigSectionHeader
                        label="Prompt"
                        variant="prompt"
                        currentModel="gpt-4o"
                        collapsed
                    />
                }
                s={<AgentaConfigSectionHeader variant="prompt" collapsed />}
            />
            <Row
                label="code · runtime"
                a={<AntdConfigSectionHeader label="Code" variant="code" codeRuntime="python" />}
                s={<AgentaConfigSectionHeader variant="code" codeRuntime="python" />}
            />
            <Row
                label="code · no runtime"
                a={<AntdConfigSectionHeader label="Code" variant="code" />}
                s={<AgentaConfigSectionHeader variant="code" />}
            />
            <Row
                label="feedback · basic"
                a={<AntdConfigSectionHeader label="Feedback Config" variant="feedback" />}
                s={<AgentaConfigSectionHeader variant="feedback" />}
            />
            <Row
                label="feedback · advanced"
                a={
                    <AntdConfigSectionHeader
                        label="Feedback Config"
                        variant="feedback"
                        feedbackMode="advanced"
                    />
                }
                s={<AgentaConfigSectionHeader variant="feedback" feedbackMode="advanced" />}
            />
        </div>
    ),
}
