/**
 * Unit tests for the picker's LIVE subscription rows.
 *
 * The runner's subscription-status answer is the only source that can attribute a mounted login to
 * a provider for a general harness: Pi reads whichever login is there, so no static map can say a
 * ChatGPT plan is also readable by Pi. What these pin down is the derivation the ref image turns
 * on — ready pairs become one row per PLAN whose flyout splits by harness — plus the fallback that
 * keeps the menu intact while the runner has not answered.
 *
 * Runs under @agenta/entity-ui's own vitest runner.
 */
import {subscriptionPairsFrom, type SubscriptionPair} from "@agenta/entities/secret"
import {describe, expect, it} from "vitest"

import {buildConnectionPickerRows} from "../../src/DrillInView/SchemaControls/connectionPicker"
import type {HarnessCapabilitiesMap} from "../../src/DrillInView/SchemaControls/connectionUtils"
import {harnessSections} from "../../src/DrillInView/SchemaControls/pickerSections"

/** Pi and Codex both publish the openai family; Claude Code publishes anthropic. */
const CAPABILITIES: HarnessCapabilitiesMap = {
    pi_core: {
        providers: ["openai", "anthropic"],
        deployments: ["direct"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "provider/id",
        models: {
            openai: ["openai/gpt-5.6-sol", "openai/gpt-5.6-luna"],
            anthropic: ["anthropic/claude-fable-5"],
        },
        default_models: {openai: ["openai/gpt-5.6-sol"]},
    },
    codex: {
        providers: ["openai"],
        deployments: ["direct"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "alias",
        models: {openai: ["gpt-5.6-sol", "gpt-5.6-luna"]},
    },
    claude: {
        providers: ["anthropic"],
        deployments: ["direct"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "alias",
        models: {anthropic: ["claude-fable-5"]},
    },
}

const HARNESS_IDS = ["pi_core", "codex", "claude"]

const rowsFor = (
    subscriptionPairs: SubscriptionPair[] | null,
    pairModelSelection?: Record<string, string[] | undefined>,
) =>
    buildConnectionPickerRows({
        connections: [],
        capabilities: CAPABILITIES,
        harnessIds: HARNESS_IDS,
        subscriptionPairs,
        pairModelSelection,
    })

describe("subscription rows from the runner's live pairs", () => {
    it("gives a plan read by two harnesses ONE row with a section each", () => {
        // The ref image: a ChatGPT login the runner reports as ready in both Codex and Pi.
        const pairs = subscriptionPairsFrom({
            codex: {state: "ready"},
            pi_core: {state: "ready", provider: "openai"},
        })
        const rows = rowsFor(pairs)

        expect(rows.map((row) => [row.name, row.key])).toEqual([["ChatGPT", "subscription:openai"]])
        expect(harnessSections(rows[0]).map((section) => [section.label, section.iconKey])).toEqual(
            [
                ["Codex", "codex"],
                ["Pi", "pi_core"],
            ],
        )
    })

    it("gives a ChatGPT row both sections when the runner names Pi's login family", () => {
        // The founder's mount: one ChatGPT login, read by Codex and by Pi. The runner now says
        // WHICH plan Pi holds, so Pi's models join the plan's row instead of going unlisted.
        const pairs = subscriptionPairsFrom({
            codex: {state: "ready"},
            pi_core: {state: "ready", providers: ["openai"]},
        })
        const rows = rowsFor(pairs)

        expect(rows.map((row) => row.name)).toEqual(["ChatGPT"])
        expect(harnessSections(rows[0]).map((section) => section.label)).toEqual(["Codex", "Pi"])
    })

    it("gives a ChatGPT row a Pi section alone when only Pi is signed in", () => {
        const pairs = subscriptionPairsFrom({
            codex: {state: "login_missing"},
            pi_core: {state: "ready", providers: ["openai"]},
        })
        const rows = rowsFor(pairs)

        expect(rows.map((row) => [row.name, row.key])).toEqual([["ChatGPT", "subscription:openai"]])
        expect(harnessSections(rows[0]).map((section) => section.label)).toEqual(["Pi"])
    })

    it("splits a Pi mount holding two logins into a row per plan", () => {
        const pairs = subscriptionPairsFrom({
            pi_core: {state: "ready", providers: ["anthropic", "openai"]},
        })
        const rows = rowsFor(pairs)

        expect(rows.map((row) => row.name)).toEqual(["Claude", "ChatGPT"])
        expect(rows.flatMap((row) => row.models.map((model) => model.modelId))).toEqual([
            "anthropic/claude-fable-5",
            "openai/gpt-5.6-sol",
        ])
    })

    it("keeps two different plans as two rows", () => {
        const pairs = subscriptionPairsFrom({
            claude: {state: "ready"},
            codex: {state: "ready"},
        })
        expect(rowsFor(pairs).map((row) => row.name)).toEqual(["Claude", "ChatGPT"])
    })

    it("offers only what the runner reports ready", () => {
        // A login the runner cannot use is not a row: the drawer's setup flow owns that state.
        const pairs = subscriptionPairsFrom({
            codex: {state: "ready"},
            claude: {state: "login_missing"},
        })
        expect(rowsFor(pairs).map((row) => row.name)).toEqual(["ChatGPT"])
    })

    it("spells each pair's models the way ITS harness does", () => {
        const pairs = subscriptionPairsFrom({
            codex: {state: "ready"},
            pi_core: {state: "ready", provider: "openai"},
        })
        const sections = harnessSections(rowsFor(pairs)[0])

        // Codex names bare aliases, Pi prefixes the family — the same plan, two spellings.
        expect(sections[0].options.map((option) => option.value)).toEqual([
            "gpt-5.6-sol",
            "gpt-5.6-luna",
        ])
        // Pi published a recommended set, so only that shows until the user says otherwise.
        expect(sections[1].options.map((option) => option.value)).toEqual(["openai/gpt-5.6-sol"])
    })

    it("honours the model list the user chose for one pair, leaving the other alone", () => {
        // The drawer stores this selection FOR this menu, keyed by pair.
        const pairs = subscriptionPairsFrom({
            codex: {state: "ready"},
            pi_core: {state: "ready", provider: "openai"},
        })
        const sections = harnessSections(rowsFor(pairs, {"openai:codex": ["gpt-5.6-luna"]})[0])

        expect(sections[0].options.map((option) => option.value)).toEqual(["gpt-5.6-luna"])
        expect(sections[1].options.map((option) => option.value)).toEqual(["openai/gpt-5.6-sol"])
    })

    it("drops a pair the user emptied, rather than falling back to the plan's list", () => {
        // An empty saved list is a choice ("show me none of these"), not an absent one.
        const pairs = subscriptionPairsFrom({
            codex: {state: "ready"},
            pi_core: {state: "ready", provider: "openai"},
        })
        const sections = harnessSections(rowsFor(pairs, {"openai:codex": []})[0])
        expect(sections.map((section) => section.label)).toEqual(["Pi"])
    })

    it("persists the plan's family and no slug, whichever harness the row came from", () => {
        const pairs = subscriptionPairsFrom({pi_core: {state: "ready", provider: "openai"}})
        const models = rowsFor(pairs)[0].models

        expect(models.every((model) => model.mode === "self_managed")).toBe(true)
        expect(models.every((model) => model.slug === null)).toBe(true)
        // A self_managed pick with no family leaves the server to guess one and the run is rejected.
        expect(models.every((model) => model.provider === "openai")).toBe(true)
    })

    it("falls back to the static mapping ONLY while the runner has not answered", () => {
        // Loading, an old runner, an unreachable service (null): the menu holds its shape rather
        // than losing every subscription row mid-check.
        // Static rows follow `harnessIds` order (codex before claude here), the live ones follow
        // the runner's harness-id sort — both deterministic, neither claiming the other's order.
        expect(rowsFor(null).map((row) => row.name)).toEqual(["ChatGPT", "Claude"])

        // An answered "none ready" ([]) is authoritative and lists NO subscription rows. The old
        // behavior treated it like null, which offered plans a deployment with no mounted login
        // could never run — the bug this distinction exists to prevent.
        expect(rowsFor([] as SubscriptionPair[])).toEqual([])
    })

    it("lets the live answer REMOVE a row the static mapping would have shown", () => {
        // Only Codex is signed in, so the Claude plan the static map assumes is not offered.
        const pairs = subscriptionPairsFrom({codex: {state: "ready"}})
        expect(rowsFor(pairs).map((row) => row.name)).toEqual(["ChatGPT"])
    })
})
