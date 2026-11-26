import {describe, expect, it} from "vitest"

import type {ProviderConnection} from "../../src/secret/core/connections"
import {buildModelProviderList} from "../../src/secret/core/modelProviderList"
import {SecretKind, SecretManagementPolicy} from "../../src/secret/core/types"

const connection = (id: string, overrides: Partial<ProviderConnection> = {}): ProviderConnection =>
    ({
        id,
        name: id,
        kind: "openai",
        title: "OpenAI",
        secretKind: SecretKind.ProviderKey,
        hasStoredCredential: true,
        ...overrides,
    }) as ProviderConnection

const subscription = (id: string, provider: string, loginState: string) =>
    connection(id, {
        kind: provider,
        subscription: {provider, loginState} as ProviderConnection["subscription"],
    })

describe("buildModelProviderList", () => {
    it("groups the built-in models, the subscriptions and the API keys", () => {
        const list = buildModelProviderList({
            connections: [
                connection("anthropic", {kind: "anthropic"}),
                subscription("chatgpt", "chatgpt", "ready"),
                connection("openai"),
                subscription("claude", "claude", "expired"),
            ],
            builtinEndpoints: [
                {slug: "agenta", models: ["google/gemini-3.8-flash", "google/gemini-4-argon"]},
                {slug: "agenta-2", models: ["google/gemini-4-argon", "google/gemini-3.7-flash"]},
            ],
        })
        // Every built-in model shows, each once: none is hidden (no per-project switch).
        expect(list.builtin?.models).toEqual([
            "google/gemini-3.8-flash",
            "google/gemini-4-argon",
            "google/gemini-3.7-flash",
        ])
        expect(list.subscriptions.map((row) => [row.connection.id, row.signInNeeded])).toEqual([
            ["chatgpt", false],
            ["claude", true],
        ])
        expect(list.apiKeys.map((row) => row.id)).toEqual(["anthropic", "openai"])
    })

    it("has no Agenta row when the deployment serves no built-in models", () => {
        expect(buildModelProviderList({connections: [], builtinEndpoints: []}).builtin).toBeNull()
        expect(
            buildModelProviderList({connections: [], builtinEndpoints: undefined}).builtin,
        ).toBeNull()
    })

    it("leaves out organization and manager-only connections", () => {
        const list = buildModelProviderList({
            connections: [
                connection("org", {scope: "organization"}),
                connection("credits", {managementPolicy: SecretManagementPolicy.ManagerOnly}),
                connection("mine"),
            ],
            builtinEndpoints: [],
        })
        expect(list.apiKeys.map((row) => row.id)).toEqual(["mine"])
    })
})
