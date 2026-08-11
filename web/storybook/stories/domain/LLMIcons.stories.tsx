import {LLMIconMap} from "@agenta/ui/llm-icons"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * LLMIcons — the SVG icon set for LLM providers (OpenAI, Anthropic, Google, etc.).
 * `LLMIconMap` maps a provider display name to its icon component. This is an
 * agenta-only showcase (no antd counterpart): a gallery grid of every icon.
 */
const meta = {
    title: "@agenta/ui/Domain/LLMIcons",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The SVG icon set for LLM providers; `LLMIconMap` maps a provider display name to its icon component. An agenta-only gallery rendered off the static icon map (no single component to document).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

/** Gallery of every provider icon in `LLMIconMap`, keyed by provider name. */
export const Gallery: Story = {
    render: () => {
        const entries = Object.entries(LLMIconMap)
        return (
            <div className="flex flex-col gap-4 max-w-[880px]">
                <div className="text-xs text-colorTextSecondary">
                    {entries.length} provider icons from <code>@agenta/ui/llm-icons</code>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                    {entries.map(([name, Icon]) => (
                        <div
                            key={name}
                            className="flex flex-col items-center justify-center gap-2 rounded-md border border-colorBorderSecondary p-4"
                        >
                            <Icon className="w-8 h-8" />
                            <span className="text-[11px] text-colorTextSecondary text-center leading-tight">
                                {name}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        )
    },
}

/** The same icons at a few sizes to confirm they scale via `className`. */
export const Sizes: Story = {
    render: () => {
        const sample = ["OpenAI", "Anthropic", "Google Gemini", "Mistral AI", "Groq"] as const
        const sizes = [
            {label: "16px", cls: "w-4 h-4"},
            {label: "24px", cls: "w-6 h-6"},
            {label: "40px", cls: "w-10 h-10"},
        ]
        return (
            <div className="flex flex-col gap-4">
                {sizes.map((s) => (
                    <div key={s.label} className="flex items-center gap-6">
                        <span className="w-14 text-xs text-colorTextSecondary">{s.label}</span>
                        <div className="flex items-center gap-4">
                            {sample.map((name) => {
                                const Icon = LLMIconMap[name]
                                return Icon ? <Icon key={name} className={s.cls} /> : null
                            })}
                        </div>
                    </div>
                ))}
            </div>
        )
    },
}
