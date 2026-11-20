/**
 * The model count the connected row's subtitle folds in. The subtitle's text is pinned in
 * @agenta/entity-ui (providerCardText.test.ts).
 */
import {describe, expect, it} from "vitest"

import {connectionModelCount} from "../../src/secret/core/connectionSummary"
import type {HarnessCapabilityMap, ProviderConnection} from "../../src/secret/core/connections"
import {SecretKind} from "../../src/secret/core/types"

const connection = (overrides: Partial<ProviderConnection> = {}): ProviderConnection => ({
    id: "id",
    name: "OpenAI",
    kind: "openai",
    title: "OpenAI",
    secretKind: SecretKind.ProviderKey,
    source: {},
    ...overrides,
})

const capabilities: HarnessCapabilityMap = {
    pi_core: {
        providers: ["openai"],
        models: {openai: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]},
        default_models: {openai: ["gpt-5.6-sol", "gpt-5.6-terra"]},
    },
}

describe("connectionModelCount", () => {
    it("counts the saved list when the connection has one", () => {
        expect(connectionModelCount(connection({models: ["a", "b"]}), capabilities)).toBe(2)
    })

    it("counts a deliberate empty list as none, not as defaults", () => {
        expect(connectionModelCount(connection({models: []}), capabilities)).toBe(0)
    })

    it("falls back to Agenta's defaults for the family when nothing was saved", () => {
        expect(connectionModelCount(connection(), capabilities)).toBe(2)
    })

    it("counts a credential-set connection against what its own endpoint serves", () => {
        expect(
            connectionModelCount(
                connection({
                    kind: "custom",
                    secretKind: SecretKind.CustomProvider,
                    source: {modelKeys: ["one", "two", "three"]},
                }),
                capabilities,
            ),
        ).toBe(3)
    })
})
