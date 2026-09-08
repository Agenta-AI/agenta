/**
 * The hosted subscription's row in the agent model picker.
 *
 * Two rules the design turns on: a ready connection is a normal row whose models carry the record's
 * slug, and a connection whose sign-in is not usable still SHOWS, disabled, saying why. The second
 * one is the whole reason `buildConnectionPickerRows` looks at the connections and not only at the
 * candidates: a not-ready connection contributes no candidate, so it would otherwise vanish exactly
 * when the user needs to be told.
 */
import {
    buildAgentModelCandidates,
    SecretKind,
    type HarnessCapabilityMap,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {describe, expect, it} from "vitest"

import {buildConnectionPickerRows} from "../../src/DrillInView/SchemaControls/connectionPicker"
import type {HarnessCapabilitiesMap} from "../../src/DrillInView/SchemaControls/connectionUtils"
import {buildPickerGroupsWithSections} from "../../src/DrillInView/SchemaControls/pickerSections"

const CAPABILITIES = {
    pi_core: {
        providers: ["openai"],
        deployments: ["direct"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "provider/id",
        models: {openai: ["openai/gpt-5.5"]},
    },
} satisfies HarnessCapabilityMap

const HARNESS_IDS = ["pi_core"]

const subscriptionConnection = (loginState: string): ProviderConnection => ({
    id: "sub-1",
    slug: "chatgpt",
    name: "ChatGPT",
    kind: "openai",
    title: "ChatGPT",
    secretKind: "subscription_provider" as SecretKind,
    models: ["gpt-5.6-sol", "gpt-5.5"],
    harnesses: ["pi_core"],
    hasStoredCredential: loginState !== "pending_login",
    subscription: {provider: "chatgpt", loginState},
    source: {name: "ChatGPT", provider: "chatgpt"} as ProviderConnection["source"],
})

const rowsFor = (loginState: string) => {
    const connections = [subscriptionConnection(loginState)]
    return buildConnectionPickerRows({
        candidates: buildAgentModelCandidates({
            connections,
            capabilities: CAPABILITIES,
            harnessIds: HARNESS_IDS,
            subscriptionPairs: [],
        }),
        connections,
        capabilities: CAPABILITIES as HarnessCapabilitiesMap,
    })
}

describe("the hosted subscription row", () => {
    it("is a normal, pickable row once the sign-in is ready", () => {
        const [row] = rowsFor("ready")

        expect(row).toMatchObject({key: "sub-1", name: "ChatGPT", kind: "subscription"})
        expect(row.disabled).toBeUndefined()
        expect(row.models.map((model) => model.modelId)).toEqual(["gpt-5.6-sol", "gpt-5.5"])
        // Every model carries the record's slug and Pi's own provider id for the family.
        expect(row.models.every((model) => model.slug === "chatgpt")).toBe(true)
        expect(row.models.every((model) => model.mode === "self_managed")).toBe(true)
        expect(row.models.every((model) => model.provider === "openai-codex")).toBe(true)
    })

    it("still shows, disabled and explained, while the sign-in is not usable", () => {
        for (const loginState of ["pending_login", "needs_login"]) {
            const rows = rowsFor(loginState)

            expect(rows).toHaveLength(1)
            expect(rows[0]).toMatchObject({
                key: "sub-1",
                name: "ChatGPT",
                kind: "subscription",
                disabled: true,
                hint: "Sign in needed",
                models: [],
            })
        }
    })

    it("carries the disabled state and the reason into the picker group", () => {
        const [group] = buildPickerGroupsWithSections(rowsFor("needs_login"))

        expect(group).toMatchObject({
            key: "sub-1",
            label: "ChatGPT",
            tag: "Subscription",
            tagTone: "olive",
            disabled: true,
            caption: "Sign in needed",
        })
        expect(group.options).toEqual([])
    })

    it("marks a ready row as a subscription without disabling it", () => {
        const [group] = buildPickerGroupsWithSections(rowsFor("ready"))

        expect(group.tag).toBe("Subscription")
        expect(group.disabled).toBeUndefined()
        expect(group.options).toHaveLength(2)
    })
})

/**
 * The row explains a SIGN-IN, so it may only appear where a sign-in is the fix.
 *
 * A subscription can also be absent from the picker because the agent runs a harness it does not
 * drive. "Sign in needed" there is a false instruction: the user signs in and the row still never
 * comes back. `harnessIds` is what tells the two apart.
 */
describe("the hosted subscription row against the agent's harness", () => {
    const rowsWithoutCandidates = (loginState: string, harnessIds: string[]) =>
        buildConnectionPickerRows({
            candidates: [],
            connections: [subscriptionConnection(loginState)],
            capabilities: CAPABILITIES as HarnessCapabilitiesMap,
            harnessIds,
        })

    it("says nothing when a ready sign-in simply does not fit this agent", () => {
        expect(rowsWithoutCandidates("ready", ["claude"])).toEqual([])
    })

    it("says nothing about a dead sign-in this agent could not use either", () => {
        expect(rowsWithoutCandidates("needs_login", ["claude"])).toEqual([])
    })

    it("still explains a dead sign-in on an agent that runs the right harness", () => {
        expect(rowsWithoutCandidates("needs_login", HARNESS_IDS)).toMatchObject([
            {key: "sub-1", disabled: true, hint: "Sign in needed"},
        ])
    })

    it("drops a ready connection that yielded no candidates, whatever the reason", () => {
        // With no narrowing the picker cannot tell "wrong harness" from anything else, so a ready
        // connection with no models to offer is simply absent rather than wrongly explained.
        expect(rowsWithoutCandidates("ready", HARNESS_IDS)).toEqual([])
    })
})
