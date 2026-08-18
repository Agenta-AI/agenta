/**
 * The connected row's ONE subtitle, and the model count it folds in.
 *
 * The drawer's Connected rows carry no pills and no second status text — everything the row knows
 * has to survive in this line, and a part with nothing to say has to disappear rather than leave a
 * dangling separator.
 */
import {describe, expect, it} from "vitest"

import {connectedRowSubtitle, connectionModelCount} from "../../src/secret/core/connectionSummary"
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

describe("connectedRowSubtitle", () => {
    it("folds credential, model count, and harnesses into one line", () => {
        expect(
            connectedRowSubtitle({
                credential: "sk-••••AAA",
                modelCount: 3,
                harnessLabels: ["Pi", "Claude Code"],
            }),
        ).toBe("sk-••••AAA · 3 models · Pi, Claude Code")
    })

    it("counts one model in the singular", () => {
        expect(
            connectedRowSubtitle({credential: "sk-••••AAA", modelCount: 1, harnessLabels: ["Pi"]}),
        ).toBe("sk-••••AAA · 1 model · Pi")
    })

    it("drops a part with nothing to say rather than leaving a dangling separator", () => {
        expect(connectedRowSubtitle({credential: "—", modelCount: 0, harnessLabels: []})).toBe(
            "0 models",
        )
    })
})

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
