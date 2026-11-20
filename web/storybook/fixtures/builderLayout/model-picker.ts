import {transformSecret} from "@agenta/entities/secret"
import type {ProviderGroup} from "@agenta/ui/select-llm-provider"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

export const MODEL_PICKER_USER_ID = "0193a000-0000-7000-8000-0000000000aa"

type SecretRow = Parameters<typeof transformSecret>[0][number]

const subscription = (id: string, provider: string, name: string, loginState: string) =>
    ({
        id,
        slug: provider,
        kind: "subscription_provider",
        header: {name},
        value_status: {configured: true},
        data: {
            provider,
            harnesses: provider === "chatgpt" ? ["codex"] : ["claude"],
            models: [],
            login_state: loginState,
            login_version: 1,
            login_generation: 1,
            login_error: null,
        },
    }) as unknown as SecretRow

const apiKey = (id: string, kind: string, name: string) =>
    ({
        id,
        slug: kind,
        kind: "provider_key",
        header: {name},
        value_status: {configured: true},
        data: {kind, provider: {key: "sk-••••f2K"}},
    }) as unknown as SecretRow

/**
 * F09 f1: the built-in models, a ChatGPT subscription, a Claude subscription that needs a new
 * sign-in, and Anthropic and OpenAI keys.
 */
export function modelProvidersQueries(scope: StoryScope): [readonly unknown[], unknown][] {
    return [
        [
            ["vault", "secrets", MODEL_PICKER_USER_ID, scope.projectId],
            transformSecret([
                subscription("sub-chatgpt", "chatgpt", "ChatGPT", "ready"),
                subscription("sub-claude", "claude", "Claude", "refresh_failed"),
                apiKey("key-anthropic", "anthropic", "Anthropic"),
                apiKey("key-openai", "openai", "OpenAI"),
            ]),
        ],
        [
            ["gateways", "llms", "builtin", scope.projectId],
            [
                {
                    slug: "agenta",
                    models: [
                        "google/gemini-3.8-flash",
                        "google/gemini-4-argon",
                        "google/gemini-3.7-flash",
                    ],
                },
            ],
        ],
    ]
}

const pick = (connection: string, value: string, label: string) => ({
    value,
    label,
    key: `${connection}:${value}`,
})

/** F01 f2: the model groups of the canvas, as the picker builds them. */
export const MODEL_PICKER_GROUPS: ProviderGroup[] = [
    {
        key: "builtin:agenta",
        label: "Agenta",
        tag: "Built-in",
        iconKey: "agenta",
        options: [],
        sections: [
            {
                key: "pi_core",
                label: "Pi",
                iconKey: "pi_core",
                options: [
                    pick("builtin", "google/gemini-3.8-flash", "Gemini 3.8 Flash"),
                    pick("builtin", "google/gemini-4-argon", "Gemini 4 Argon"),
                    pick("builtin", "google/gemini-3.7-flash", "Gemini 3.7 Flash"),
                ],
            },
        ],
    },
    {
        key: "anthropic",
        label: "Anthropic",
        tag: "Organization",
        iconKey: "anthropic",
        options: [],
        sections: [
            {
                key: "claude",
                label: "Claude Code",
                iconKey: "claude",
                options: [
                    pick("anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5"),
                    pick("anthropic", "claude-opus-5-5", "Claude Opus 5.5"),
                    pick("anthropic", "claude-haiku-5-5", "Claude Haiku 5.5"),
                ],
            },
        ],
    },
    {
        key: "openai",
        label: "OpenAI",
        iconKey: "openai",
        options: [],
        sections: [
            {
                key: "pi_core",
                label: "Pi",
                iconKey: "pi_core",
                options: [
                    pick("openai", "gpt-5.5", "GPT-5.5"),
                    pick("openai", "gpt-5.5-mini", "GPT-5.5 mini"),
                ],
            },
        ],
    },
    {
        key: "chatgpt",
        label: "ChatGPT subscription",
        tag: "Subscription",
        tagTone: "olive",
        iconKey: "openai",
        options: [],
        sections: [
            {
                key: "codex",
                label: "Codex",
                iconKey: "codex",
                options: [pick("chatgpt", "gpt-5.6-sol", "GPT-5.6 Sol")],
            },
        ],
    },
    {
        key: "claude-subscription",
        label: "Claude subscription",
        tag: "Subscription",
        tagTone: "olive",
        iconKey: "anthropic",
        disabled: true,
        caption: "Sign in needed",
        options: [],
    },
].map((group) => ({
    ...group,
    options: (group.sections ?? []).flatMap((section) => section.options),
}))
