/**
 * Unit tests for `agentProviderNeedsKey`, the rule behind the Model section's "Connect key" badge
 * and its "Connect the model's provider key to run this agent." tooltip.
 *
 * Issue #6660: the playground kept asking for a provider key after one was added and while the
 * agent ran on it. The rule read the value off the vault row, and a write-only record never
 * returns its value — it reports presence through `hasKey` — so every connected project on a
 * write-only deployment (staging, and any current dev stack) read as keyless forever.
 *
 * The row shapes below are the ones the vault really serves: a write-only record, a readable one,
 * an unconnected catalog entry, and a row restored from IndexedDB (values replaced by a sentinel).
 */
import {describe, expect, it} from "vitest"

import {agentProviderNeedsKey} from "../../src/DrillInView/SchemaControls/agentTemplate/providerKeyGate"

/** A catalog row for a provider the project has not connected. */
const unconnected = {name: "OPENAI_API_KEY", title: "openai"}

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

/** A row restored from IndexedDB: the value is a truthy sentinel, presence rides on `hasKey`. */
const restoredFromDisk = {...writeOnlyConnected, key: "[redacted]"}

const gate = (overrides: Partial<Parameters<typeof agentProviderNeedsKey>[0]> = {}) =>
    agentProviderNeedsKey({
        connectionMode: "agenta",
        connectionSlug: null,
        vaultLoaded: true,
        providerEntry: unconnected,
        ...overrides,
    })

describe("agentProviderNeedsKey", () => {
    it("asks for a key while the project has none", () => {
        expect(gate()).toBe(true)
    })

    it("stops asking once a write-only key is stored (issue #6660)", () => {
        // The regression: the row carries no value to read, only `hasKey`. Reading the value here
        // left the badge standing over a key the agent was already running on.
        expect(gate({providerEntry: writeOnlyConnected})).toBe(false)
    })

    it("stops asking for a readable key too", () => {
        expect(gate({providerEntry: readableConnected})).toBe(false)
    })

    it("stops asking for a row restored from disk", () => {
        expect(gate({providerEntry: restoredFromDisk})).toBe(false)
    })

    it("never asks while the vault is still loading", () => {
        // `standardSecretsAtom` serves the static catalog with empty keys until the query lands,
        // so asserting there would flash the badge on every load.
        expect(gate({vaultLoaded: false})).toBe(false)
    })

    it("never asks for a provider family outside the vault catalog", () => {
        expect(gate({providerEntry: null})).toBe(false)
    })

    it("never asks a self-managed connection, which signs itself in", () => {
        expect(gate({connectionMode: "self_managed"})).toBe(false)
    })

    it("never asks a named connection, which carries its own credentials", () => {
        expect(gate({connectionMode: "agenta", connectionSlug: "openai-6092496d30e7"})).toBe(false)
    })
})
