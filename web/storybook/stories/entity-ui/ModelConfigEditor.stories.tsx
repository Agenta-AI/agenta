import {ModelConfigEditor} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {AntdModelConfigEditor} from "./playgroundConfigSectionAntd"
import {LLM_CONFIG_PROPS, MODEL_OPTIONS, noop} from "./playgroundConfigSectionFixtures"

// ModelConfigEditor — the "Model" pane of the configure popover: provider picker, one control
// per LLM-config property, and the Advanced (chat_template_kwargs) disclosure. antd
// `Typography.Text` + `Select allowClear` replaced by a plain span and the composed
// `ConfigSelect` (@agenta/ui Select + antd's clear affordance). `SelectLLMProviderBase` and
// `NumberSliderControl` are shared by both halves — they are not part of this chunk.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ModelConfigEditor",
    component: ModelConfigEditor,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Model pane of the configure popover. antd Select (allowClear) → composed ConfigSelect on the @agenta/ui Select; antd Typography.Text → span + colorTextDescription.",
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
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[296px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[296px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

const SELECT_NOTE =
    "enum field: antd small Select (11px→7px pad) vs composed ConfigSelect on the @agenta/ui Select trigger at size=sm; the clear button is hover-only on both"

export const AntdVsAgenta: Story = {
    args: {...BASE, value: {}},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="empty"
                expected={SELECT_NOTE}
                a={<AntdModelConfigEditor {...BASE} value={{}} />}
                s={<ModelConfigEditor {...BASE} value={{}} />}
            />
            <Row
                label="with values"
                expected={SELECT_NOTE}
                a={
                    <AntdModelConfigEditor
                        {...BASE}
                        value={{model: "gpt-4o", temperature: 0.7, tool_choice: "auto"}}
                    />
                }
                s={
                    <ModelConfigEditor
                        {...BASE}
                        value={{model: "gpt-4o", temperature: 0.7, tool_choice: "auto"}}
                    />
                }
            />
            <Row
                label="disabled"
                expected={SELECT_NOTE}
                a={
                    <AntdModelConfigEditor
                        {...BASE}
                        value={{model: "gpt-4o", temperature: 0.7, tool_choice: "auto"}}
                        disabled
                    />
                }
                s={
                    <ModelConfigEditor
                        {...BASE}
                        value={{model: "gpt-4o", temperature: 0.7, tool_choice: "auto"}}
                        disabled
                    />
                }
            />
        </div>
    ),
}
