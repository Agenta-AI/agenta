/**
 * `shouldPromptForProviderKey` drives the Model section's "Connect key" badge and tooltip.
 * Fixtures are the row shapes the vault really serves; #6660 was the write-only one.
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

/** Restored from IndexedDB: `redactVaultSecretRow` swapped the value for a truthy sentinel. */
const readableRestoredFromDisk = {...readableConnected, key: "[redacted]"}

/** Restored from IndexedDB: nothing to redact, so it returns exactly as the API served it. */
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
        // No value to read, only `hasKey`: reading the value left the badge over a working key.
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
        // The record's own answer wins; `hasKey || key` would hide the prompt on a keyless project.
        expect(
            prompt({standardProviderEntry: {...unconnected, hasKey: false, key: "sk-stale"}}),
        ).toBe(true)
    })

    it("never asks while the vault is still loading", () => {
        // The catalog serves empty keys until the query lands; asserting there flashes the badge.
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
