import {useState} from "react"

import {SelectLLMProviderBase, type ProviderGroup} from "@agenta/ui/select-llm-provider"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * SelectLLMProvider — grouped provider/model picker built on the shared Popover +
 * Select-trigger primitives, with per-provider icons (via LLMIconMap) and an optional
 * cascading model panel. The main app extends this with vault integration; here it
 * renders standalone with a MOCKED provider/model list.
 */
const meta = {
    title: "@agenta/ui/Domain/SelectLLMProvider",
    component: SelectLLMProviderBase,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A grouped provider/model picker built on the shared Popover + Select-trigger primitives, with per-provider icons and an optional cascading model panel. Rendered here standalone off a mocked provider/model list (the app extends it with vault integration).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

// Mocked provider groups with a few models each. Group labels match LLMIconMap keys
// so the provider icons resolve.
const MOCK_OPTIONS: ProviderGroup[] = [
    {
        label: "OpenAI",
        options: [
            {label: "gpt-4o", value: "openai/gpt-4o"},
            {label: "gpt-4o-mini", value: "openai/gpt-4o-mini"},
            {label: "gpt-3.5-turbo", value: "openai/gpt-3.5-turbo"},
        ],
    },
    {
        label: "Anthropic",
        options: [
            {label: "claude-3-5-sonnet", value: "anthropic/claude-3-5-sonnet"},
            {label: "claude-3-opus", value: "anthropic/claude-3-opus"},
            {label: "claude-3-haiku", value: "anthropic/claude-3-haiku"},
        ],
    },
    {
        label: "Google Gemini",
        options: [
            {label: "gemini-1.5-pro", value: "gemini/gemini-1.5-pro"},
            {label: "gemini-1.5-flash", value: "gemini/gemini-1.5-flash"},
        ],
    },
    {
        label: "Mistral AI",
        options: [
            {label: "mistral-large", value: "mistral/mistral-large"},
            {label: "mistral-small", value: "mistral/mistral-small"},
        ],
    },
]

/** Grouped picker with search + the cascading model panel on provider hover. */
export const Grouped: Story = {
    render: () => {
        const Demo = () => {
            const [value, setValue] = useState<string>("openai/gpt-4o")
            return (
                <div className="w-[320px]">
                    <SelectLLMProviderBase
                        value={value}
                        onChange={(v) => setValue(v as string)}
                        options={MOCK_OPTIONS}
                        showGroup
                        showSearch
                        placeholder="Select a model"
                    />
                </div>
            )
        }
        return <Demo />
    },
}

/** Error skin (antd `status="error"` / a failed `Form.Item` rule) — red border, text and arrow. */
export const Invalid: Story = {
    render: () => (
        <div className="flex w-[320px] flex-col gap-3">
            <SelectLLMProviderBase
                options={MOCK_OPTIONS}
                showGroup
                showSearch
                invalid
                placeholder="Select a model"
            />
            <SelectLLMProviderBase
                value="openai/gpt-4o"
                options={MOCK_OPTIONS}
                showGroup
                showSearch
                invalid
            />
            <span className="text-xs text-error">Please select a provider</span>
        </div>
    ),
}

/** Flat list (no grouping), still icon-annotated per provider. */
export const Flat: Story = {
    render: () => {
        const Demo = () => {
            const [value, setValue] = useState<string | undefined>(undefined)
            return (
                <div className="w-[320px]">
                    <SelectLLMProviderBase
                        value={value}
                        onChange={(v) => setValue(v as string)}
                        options={MOCK_OPTIONS}
                        showSearch
                        placeholder="Search models"
                    />
                </div>
            )
        }
        return <Demo />
    },
}
