/**
 * Unit tests for `shouldPromptForProviderKey`, the rule behind the Model section's "Connect key"
 * badge and its "Connect the model's provider key to run this agent." tooltip.
 *
 * Issue #6660: the playground kept asking for a provider key after one was added and while the
 * agent ran on it. The rule read the value off the vault row, and a write-only record never
 * returns its value — it reports presence through `hasKey` — so every connected project on a
 * write-only deployment (staging, and any current dev stack) read as keyless forever.
 *
 * The row shapes below are the ones the vault really serves: an unconnected catalog entry, a
 * write-only record, a readable one, and both of those restored from IndexedDB.
 */
import {describe, expect, it} from "vitest"

import {shouldPromptForProviderKey} from "../../src/DrillInView/SchemaControls/agentTemplate/providerKeyPrompt"

/** A catalog row for a provider the project has not connected, exactly as the atom serves it. */
const unconnected = {name: "OPENAI_API_KEY", title: "OpenAI", key: ""}

/** What `/secrets/` serves for a stored key on a write-only deployment: presence, no value. */
const writeOnlyConnected = {
    ...unconnected,
    id: "01a08261-1955-75c0-a2c6-17b181c87e88",
    writeOnly: true,
    hasKey: true,
    keyPreview: "sk-****AAA",
}

/** A readable record, which proves presence by carrying the value. */
const readableConnected = {...unconnected, id: "readable", key: "sk-live-value"}

/**
 * A readable row restored from IndexedDB. `redactVaultSecretRow` replaces a value it holds with a
 * truthy sentinel, so this row still carries a `key` and it is not the real one.
 */
const readableRestoredFromDisk = {...readableConnected, key: "[redacted]"}

/**
 * A write-only row restored from IndexedDB. Redaction only replaces values that are there, and a
 * write-only row never had one, so it comes back from disk exactly as the API served it: presence
 * on `hasKey`, no value anywhere.
 */
const writeOnlyRestoredFromDisk = {...writeOnlyConnected}

const prompt = (overrides: Partial<Parameters<typeof shouldPromptForProviderKey>[0]> = {}) =>
    shouldPromptForProviderKey({
        connectionMode: "agenta",
        connectionSlug: null,
        vaultLoaded: true,
        standardProviderEntry: unconnected,
        ...overrides,
    })

describe("shouldPromptForProviderKey", () => {
    it("asks for a key while the project has none", () => {
        expect(prompt()).toBe(true)
    })

    it("stops asking once a write-only key is stored (issue #6660)", () => {
        // The regression: the row carries no value to read, only `hasKey`. Reading the value here
        // left the badge standing over a key the agent was already running on.
        expect(prompt({standardProviderEntry: writeOnlyConnected})).toBe(false)
    })

    it("stops asking for a readable key too", () => {
        expect(prompt({standardProviderEntry: readableConnected})).toBe(false)
    })

    it("stops asking for either row shape restored from disk", () => {
        expect(prompt({standardProviderEntry: readableRestoredFromDisk})).toBe(false)
        expect(prompt({standardProviderEntry: writeOnlyRestoredFromDisk})).toBe(false)
    })

    it("keeps asking when the record says the key is gone but a value lingers", () => {
        // `hasKey: false` is the record's own answer and it wins. A rule spelled `hasKey || key`
        // would read the stale value and hide the prompt on a project that has no key.
        expect(
            prompt({standardProviderEntry: {...unconnected, hasKey: false, key: "sk-stale"}}),
        ).toBe(true)
    })

    it("never asks while the vault is still loading", () => {
        // `standardSecretsAtom` serves the static catalog with empty keys until the query lands,
        // so asserting there would flash the badge on every load.
        expect(prompt({vaultLoaded: false})).toBe(false)
    })

    it("never asks for a provider family outside the vault catalog", () => {
        expect(prompt({standardProviderEntry: null})).toBe(false)
    })

    it("never asks a self-managed connection, which signs itself in", () => {
        expect(prompt({connectionMode: "self_managed"})).toBe(false)
    })

    it("never asks a named connection, which carries its own credentials", () => {
        expect(prompt({connectionMode: "agenta", connectionSlug: "openai-6092496d30e7"})).toBe(
            false,
        )
    })
})
