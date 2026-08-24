import {describe, expect, it} from "vitest"

import {
    applyAgentCreationPrefs,
    ensureEnabledSandbox,
} from "../../src/workflow/state/agentCreationPrefs"

describe("applyAgentCreationPrefs", () => {
    it("leaves the template config untouched when no prefs are set", () => {
        const template = {harness: {kind: "claude"}, llm: {model: "gpt-4o"}}
        expect(applyAgentCreationPrefs(template, {version: 1})).toEqual(template)
    })

    it("overlays only the fields the prefs carry, keeping the rest of the template", () => {
        const template = {
            harness: {kind: "claude", max_iterations: 10},
            llm: {model: "gpt-4o", temperature: 0.7},
            tools: [{name: "gmail_search"}],
        }
        const result = applyAgentCreationPrefs(template, {version: 1, harness: "pi_core"})
        expect(result.harness).toEqual({kind: "pi_core", max_iterations: 10})
        expect(result.llm).toEqual({model: "gpt-4o", temperature: 0.7})
        expect(result.tools).toBe(template.tools)
    })

    it("overlays model/provider/connectionMode without dropping other llm keys", () => {
        const template = {llm: {model: "gpt-4o", temperature: 0.5}}
        const result = applyAgentCreationPrefs(template, {
            version: 1,
            model: "claude-opus-4",
            provider: "anthropic",
            connectionMode: "self_managed",
        })
        expect(result.llm).toEqual({
            model: "claude-opus-4",
            temperature: 0.5,
            provider: "anthropic",
            connection: {mode: "self_managed"},
        })
    })

    it("preserves an existing connection slug when only the mode is overlaid", () => {
        const template = {llm: {model: "gpt-4o", connection: {mode: "agenta", slug: "my-conn"}}}
        const result = applyAgentCreationPrefs(template, {version: 1, connectionMode: "agenta"})
        expect(result.llm).toEqual({
            model: "gpt-4o",
            connection: {mode: "agenta", slug: "my-conn"},
        })
    })

    it("builds harness/llm objects from scratch when the template has none", () => {
        const result = applyAgentCreationPrefs(
            {},
            {version: 1, harness: "claude", model: "claude-opus-4"},
        )
        expect(result).toEqual({harness: {kind: "claude"}, llm: {model: "claude-opus-4"}})
    })
})

describe("ensureEnabledSandbox", () => {
    it("leaves the config untouched when the current kind is enabled", () => {
        const config = {sandbox: {kind: "local", permissions: {network: "on"}}, llm: {model: "x"}}
        expect(ensureEnabledSandbox(config, ["local"])).toBe(config)
    })

    it("leaves the config untouched when local is unset but local is enabled (runtime default)", () => {
        const config = {llm: {model: "x"}}
        expect(ensureEnabledSandbox(config, ["local", "daytona"])).toBe(config)
    })

    it("coerces the template's local default to the first enabled provider (daytona-only)", () => {
        const config = {sandbox: {kind: "local"}, llm: {model: "x"}}
        const result = ensureEnabledSandbox(config, ["daytona"])
        expect(result.sandbox).toEqual({kind: "daytona"})
        expect(result.llm).toEqual({model: "x"})
    })

    it("coerces an unset (implicit local) sandbox when local is not enabled", () => {
        const config = {llm: {model: "x"}}
        const result = ensureEnabledSandbox(config, ["daytona"])
        expect(result.sandbox).toEqual({kind: "daytona"})
    })

    it("preserves sibling sandbox keys (e.g. permissions) while coercing the kind", () => {
        const config = {sandbox: {kind: "local", permissions: {network: "off"}}}
        const result = ensureEnabledSandbox(config, ["daytona"])
        expect(result.sandbox).toEqual({kind: "daytona", permissions: {network: "off"}})
    })

    it("is a no-op when the enabled set is empty (never hide every option)", () => {
        const config = {sandbox: {kind: "local"}}
        expect(ensureEnabledSandbox(config, [])).toBe(config)
    })
})
