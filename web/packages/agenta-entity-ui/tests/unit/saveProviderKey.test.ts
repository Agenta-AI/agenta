import {
    buildConnectionPayload,
    connectionModelIds,
    SecretKind,
    type HarnessCapabilityMap,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {describe, expect, it} from "vitest"

import {
    KEY_PROVIDERS,
    keyPlaceholderFor,
    newProviderKeyDraft,
} from "../../src/secretProvider/useSaveProviderKey"

const capabilities: HarnessCapabilityMap = {
    pi_core: {
        providers: ["anthropic", "openai"],
        models: {
            anthropic: [
                "anthropic/claude-opus-4-7",
                "anthropic/claude-sonnet-4-6",
                "anthropic/claude-haiku-4-5",
            ],
        },
        default_models: {anthropic: ["anthropic/claude-opus-4-7", "anthropic/claude-sonnet-4-6"]},
    },
}

describe("saving one API key without the drawer", () => {
    it("offers only the single-key providers, most-used first", () => {
        expect(KEY_PROVIDERS.slice(0, 3).map((entry) => entry.title)).toEqual([
            "OpenAI",
            "Anthropic",
            "Google Gemini",
        ])
        expect(KEY_PROVIDERS.map((entry) => entry.kind)).not.toContain("azure")
        expect(KEY_PROVIDERS).toHaveLength(13)
    })

    it("shows each provider's key prefix, else names the key", () => {
        expect(keyPlaceholderFor("anthropic", "Anthropic")).toBe("sk-ant-…")
        expect(keyPlaceholderFor("acme", "Acme")).toBe("Acme API key")
    })

    it("sends the untouched card's draft: the key, no model list, the default harness", () => {
        const draft = newProviderKeyDraft("anthropic", "sk-ant-1a2b", capabilities)
        expect(draft).toEqual({
            kind: "anthropic",
            name: "",
            credential: {apiKey: "sk-ant-1a2b"},
            harnesses: ["pi_core"],
        })
        expect(buildConnectionPayload(draft, "Anthropic").secret.data).toEqual({
            kind: "anthropic",
            provider: {key: "sk-ant-1a2b"},
            harnesses: ["pi_core"],
        })
    })

    it("lands the saved key on the provider's recommended models", () => {
        const draft = newProviderKeyDraft("anthropic", "sk-ant-1a2b", capabilities)
        const saved = {
            kind: draft.kind,
            secretKind: SecretKind.ProviderKey,
            models: draft.models,
        } as ProviderConnection
        expect(connectionModelIds(saved, capabilities)).toEqual([
            "claude-opus-4-7",
            "claude-sonnet-4-6",
        ])
    })

    it("leaves the harness open when the default harness cannot reach the provider", () => {
        expect(newProviderKeyDraft("groq", "gsk_12345678", capabilities)).toEqual({
            kind: "groq",
            name: "",
            credential: {apiKey: "gsk_12345678"},
        })
    })
})
