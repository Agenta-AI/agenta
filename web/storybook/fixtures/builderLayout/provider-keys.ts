import {transformSecret} from "@agenta/entities/secret"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"

export const PROVIDER_KEYS_USER_ID = "0193a000-0000-7000-8000-0000000000ab"

type SecretRow = Parameters<typeof transformSecret>[0][number]

/** The OpenAI models of F09 f4 and F11 f2: six drawn rows, 42 in all. */
const OPENAI_MODELS = [
    "gpt-5.5",
    "gpt-5.5-mini",
    "gpt-5.6-sol",
    "gpt-4.1",
    "gpt-4.1-mini",
    "o4-mini",
    ...Array.from({length: 36}, (_, index) => `gpt-archive-${index + 1}`),
]

export const OPENAI_MODEL_NAMES: Record<string, string> = {
    "gpt-5.5": "GPT-5.5",
    "gpt-5.5-mini": "GPT-5.5 mini",
    "gpt-5.6-sol": "GPT-5.6 Sol",
    "gpt-4.1": "GPT-4.1",
    "gpt-4.1-mini": "GPT-4.1 mini",
    "o4-mini": "o4 mini",
}

/** The probe answers the stories use, as `POST /providers/probe` returns them. */
export const PROBE_ANSWERS = {
    works: {
        credential: {status: "valid", message: "OpenAI accepted this key."},
        discovery: {status: "fetched", models: OPENAI_MODELS, model_names: OPENAI_MODEL_NAMES},
        fetched_at: new Date().toISOString(),
    },
    rejected: {
        credential: {status: "invalid", message: "OpenAI rejected this key."},
        discovery: {status: "failed", models: [], model_names: {}},
        fetched_at: new Date().toISOString(),
    },
    untested: {
        credential: {status: "unknown", message: "Not tested."},
        discovery: {status: "unsupported", models: [], model_names: {}},
        fetched_at: new Date().toISOString(),
    },
} as const

/** Pi and Codex reach OpenAI; Claude Code reaches Anthropic only (F11 f1). */
const HARNESS_CATALOG = {
    pi_core: {
        providers: ["openai", "anthropic", "gemini", "minimax"],
        deployments: ["azure", "bedrock", "vertex_ai", "custom"],
        models: {openai: OPENAI_MODELS.slice(0, 6)},
        default_models: {openai: ["gpt-5.5", "gpt-5.5-mini", "gpt-5.6-sol"]},
    },
    claude: {providers: ["anthropic"], deployments: ["bedrock", "vertex_ai"]},
    codex: {providers: ["openai"], deployments: ["azure"]},
}

const apiKey = (id: string, kind: string, name: string) =>
    ({
        id,
        slug: kind,
        kind: "provider_key",
        header: {name},
        value_status: {configured: true, preview: "sk-••••f2K"},
        data: {
            kind,
            provider: {},
            models: [{slug: "gpt-5.5"}, {slug: "gpt-5.5-mini"}, {slug: "gpt-5.6-sol"}],
            harnesses: ["pi_core"],
        },
    }) as unknown as SecretRow

export const OPENAI_CONNECTION_ID = "key-openai"

/** The project already has an OpenAI connection named "OpenAI", so a new one is "OpenAI 2". */
export function providerKeysQueries(scope: StoryScope): [readonly unknown[], unknown][] {
    return [
        [
            ["vault", "secrets", PROVIDER_KEYS_USER_ID, scope.projectId],
            transformSecret([apiKey(OPENAI_CONNECTION_ID, "openai", "OpenAI")]),
        ],
        [["workflows", "catalog", "harnesses"], HARNESS_CATALOG],
    ]
}
