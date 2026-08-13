/**
 * Unit tests for the agent picker's harness-split flyout (`pickerSections`).
 *
 * What the spec turns on: a model row names no harness of its own (the section above it does), one
 * harness collapses to a single section the flyout renders as a `via` lead-in, several stay several,
 * and a subscription is marked by the olive tag rather than by its name. Runs under
 * @agenta/entity-ui's own vitest runner.
 */
import {SecretKind, type ProviderConnection} from "@agenta/entities/secret"
import {describe, expect, it} from "vitest"

import {buildConnectionPickerRows} from "../../src/DrillInView/SchemaControls/connectionPicker"
import type {HarnessCapabilitiesMap} from "../../src/DrillInView/SchemaControls/connectionUtils"
import {
    buildPickerGroupsWithSections,
    harnessSections,
} from "../../src/DrillInView/SchemaControls/pickerSections"

const CAPABILITIES: HarnessCapabilitiesMap = {
    pi_core: {
        providers: ["openai", "anthropic"],
        deployments: ["direct"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "provider/id",
        models: {
            openai: ["openai/gpt-5.6-sol"],
            anthropic: ["anthropic/claude-fable-5"],
        },
        model_catalog: [
            {id: "openai/gpt-5.6-sol", provider: "openai", label: "Sol (default)"},
            {id: "anthropic/claude-fable-5", provider: "anthropic", label: "Fable"},
        ],
    },
    claude: {
        providers: ["anthropic"],
        deployments: ["direct"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "alias",
        models: {anthropic: ["claude-fable-5"]},
        model_catalog: [{id: "claude-fable-5", provider: "anthropic", label: "Fable"}],
    },
}

const HARNESS_IDS = ["pi_core", "claude"]

const standard = (
    id: string,
    kind: string,
    overrides: Partial<ProviderConnection> = {},
): ProviderConnection => ({
    id,
    name: overrides.name ?? kind,
    kind,
    title: kind,
    secretKind: SecretKind.ProviderKey,
    source: {name: `${kind}_api_key`, title: kind, key: "sk-test"} as ProviderConnection["source"],
    ...overrides,
})

const rowsFor = (connections: ProviderConnection[], showSubscriptions = false) =>
    buildConnectionPickerRows({
        connections,
        capabilities: CAPABILITIES,
        harnessIds: HARNESS_IDS,
        showSubscriptions,
    })

describe("harnessSections", () => {
    it("groups a connection's models under the harness that runs them", () => {
        // Anthropic is reachable through both harnesses, so the same model appears in each section.
        const row = rowsFor([standard("1", "anthropic", {models: ["claude-fable-5"]})])[0]
        const sections = harnessSections(row)

        expect(sections.map((section) => [section.label, section.iconKey])).toEqual([
            ["Pi", "pi_core"],
            ["Claude Code", "claude"],
        ])
        expect(sections.every((section) => section.options.length === 1)).toBe(true)
    })

    it("collapses to ONE section when a connection has a single harness", () => {
        // OpenAI is Pi's alone — the flyout renders this as the `via Pi` lead-in.
        const row = rowsFor([standard("1", "openai", {models: ["gpt-5.6-sol"]})])[0]
        expect(harnessSections(row).map((section) => section.label)).toEqual(["Pi"])
    })

    it("leaves the harness off a row the flat search view can already tell apart", () => {
        // One model, one harness: nothing to disambiguate, so no pill anywhere.
        const row = rowsFor([standard("1", "openai", {models: ["gpt-5.6-sol"]})])[0]
        const options = harnessSections(row).flatMap((section) => section.options)
        expect(options.every((option) => !("tag" in option))).toBe(true)
    })

    it("names the harness only where search would show the same model twice", () => {
        // Reachable through both harnesses. The FLYOUT never draws this — its sections name the
        // harness — but the flat search list has no sections, so the rows need telling apart.
        const row = rowsFor([standard("1", "anthropic", {models: ["claude-fable-5"]})])[0]
        expect(
            harnessSections(row).flatMap((section) => section.options.map((option) => option.tag)),
        ).toEqual(["Pi", "Claude Code"])
    })

    it("splits the catalog's aside off the model name", () => {
        const row = rowsFor([standard("1", "openai", {models: ["gpt-5.6-sol"]})])[0]
        expect(harnessSections(row)[0].options[0]).toMatchObject({
            label: "Sol",
            hint: "(default)",
        })
    })

    it("leaves a model the catalog marks with nothing on its bare name", () => {
        const row = rowsFor([standard("1", "anthropic", {models: ["claude-fable-5"]})])[0]
        const option = harnessSections(row)[0].options[0]
        expect(option.label).toBe("Fable")
        expect(option.hint).toBeUndefined()
    })

    it("keeps each pair's routing metadata on its own row", () => {
        const row = rowsFor([
            standard("1", "anthropic", {slug: "anthropic-prod", models: ["claude-fable-5"]}),
        ])[0]
        expect(
            harnessSections(row).flatMap((section) =>
                section.options.map((option) => option.metadata),
            ),
        ).toEqual([
            {connectionSlug: "anthropic-prod", connectionMode: "agenta", harness: "pi_core", provider: "anthropic"}, // prettier-ignore
            {connectionSlug: "anthropic-prod", connectionMode: "agenta", harness: "claude", provider: "anthropic"}, // prettier-ignore
        ])
    })
})

describe("buildPickerGroupsWithSections", () => {
    it("keeps the flat option list search and selection resolve against", () => {
        const groups = buildPickerGroupsWithSections(
            rowsFor([standard("1", "anthropic", {name: "Anthropic prod", models: ["claude-fable-5"]})]), // prettier-ignore
        )

        const group = groups[0]
        expect(group.options).toHaveLength(2)
        expect(group.options).toHaveLength(
            group.sections!.flatMap((section) => section.options).length,
        )
        // One model under two harnesses: the value repeats, so the key must not.
        expect(new Set(group.options.map((option) => option.key)).size).toBe(2)
        expect(group.options.every((option) => option.searchCaption === "Anthropic prod")).toBe(
            true,
        )
    })

    it("marks a subscription with the olive tag, never in its name", () => {
        const groups = buildPickerGroupsWithSections(rowsFor([], true))
        const subscription = groups.find((group) => group.tag)!

        expect(subscription.tag).toBe("Subscription")
        expect(subscription.tagTone).toBe("olive")
        expect(subscription.label).not.toMatch(/subscription/i)
    })

    it("leaves a stored key untagged", () => {
        const groups = buildPickerGroupsWithSections(
            rowsFor([standard("1", "anthropic", {models: ["claude-fable-5"]})]),
        )
        expect(groups[0].tag).toBeUndefined()
    })
})
