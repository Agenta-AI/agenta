import {transformSecret} from "@agenta/entities/secret"

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
