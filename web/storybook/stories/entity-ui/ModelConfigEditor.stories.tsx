import {ModelConfigEditor} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {LLM_CONFIG_PROPS, MODEL_OPTIONS, noop} from "./playgroundConfigSectionFixtures"

// ModelConfigEditor — the "Model" pane of the configure popover: provider picker, one control
// per LLM-config property, and the Advanced (chat_template_kwargs) disclosure.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ModelConfigEditor",
    component: ModelConfigEditor,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Model pane of the configure popover: provider picker, one control per LLM-config property, and the Advanced disclosure.",
            },
        },
    },
} satisfies Meta<typeof ModelConfigEditor>

export default meta
type Story = StoryObj<typeof meta>

const BASE = {
    llmConfigProps: LLM_CONFIG_PROPS as unknown as Record<string, unknown>,
    modelOptions: MODEL_OPTIONS,
    onChange: noop,
}

export const Default: Story = {
    args: {...BASE, value: {model: "gpt-4o", temperature: 0.7, tool_choice: "auto"}},
    render: (args) => (
        <div className="w-[296px]">
            <ModelConfigEditor {...args} />
        </div>
    ),
}

export const Disabled: Story = {
    args: {...BASE, value: {model: "gpt-4o", temperature: 0.7}, disabled: true},
    render: (args) => (
        <div className="w-[296px]">
            <ModelConfigEditor {...args} />
        </div>
    ),
}

// ---------------------------------------------------------------------------

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[296px]">{children}</div>
    </div>
)

export const Variants: Story = {
    args: {...BASE, value: {}},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row label="empty">
                <ModelConfigEditor {...BASE} value={{}} />
            </Row>
            <Row label="with values">
                <ModelConfigEditor
                    {...BASE}
                    value={{model: "gpt-4o", temperature: 0.7, tool_choice: "auto"}}
                />
            </Row>
            <Row label="disabled">
                <ModelConfigEditor
                    {...BASE}
                    value={{model: "gpt-4o", temperature: 0.7, tool_choice: "auto"}}
                    disabled
                />
            </Row>
        </div>
    ),
}
