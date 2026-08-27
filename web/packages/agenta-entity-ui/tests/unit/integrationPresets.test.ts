/**
 * Preset translation for an integration's permission policy — contracts section 10, qa.md F1 to F9.
 *
 * A preset is a display of the saved shape, never a saved value. These tests pin both directions
 * plus the two rules that are easy to get wrong: picking a preset clears the per-tool map, and the
 * override count is the number of SAVED entries, including one that equals the current default.
 */
import {describe, expect, it} from "vitest"

import {
    DEFAULT_INTEGRATION_PRESET,
    integrationPermissionSummary,
    mergeToolPermission,
    presetPermissions,
    readIntegrationPreset,
    type IntegrationPreset,
} from "../../src/DrillInView/SchemaControls/integrationPolicy"
import type {GatewayConnectionPermissions} from "../../src/DrillInView/SchemaControls/toolUtils"

const empty: GatewayConnectionPermissions = {default: "inherit", tools: {}}

const write = (preset: IntegrationPreset, current = empty) => presetPermissions(preset, current)

describe("writing a preset", () => {
    it('F1: "Always ask" saves ask with an empty tools map', () => {
        expect(write("always_ask")).toEqual({default: "ask", tools: {}})
    })

    it('F2: "Ask for write and delete" saves inherit with an empty tools map', () => {
        expect(write("ask_writes")).toEqual({default: "inherit", tools: {}})
    })

    it('F3: "Allow all" saves allow with an empty tools map', () => {
        expect(write("allow_all")).toEqual({default: "allow", tools: {}})
    })

    it('F4: "Deny all" saves deny with an empty tools map', () => {
        expect(write("deny_all")).toEqual({default: "deny", tools: {}})
    })

    it("a new integration lands on the read-aware preset", () => {
        expect(DEFAULT_INTEGRATION_PRESET).toBe("ask_writes")
        expect(write(DEFAULT_INTEGRATION_PRESET)).toEqual({default: "inherit", tools: {}})
    })
})

describe("reading a preset back", () => {
    it("F5: each preset round trips", () => {
        const presets: IntegrationPreset[] = ["always_ask", "ask_writes", "allow_all", "deny_all"]
        for (const preset of presets) {
            expect(readIntegrationPreset(write(preset))).toEqual({preset, overrideCount: 0})
        }
    })

    it("F6: one per-tool override reads back as Custom", () => {
        const permissions: GatewayConnectionPermissions = {
            default: "inherit",
            tools: {CREATE_ISSUE: "ask"},
        }
        expect(readIntegrationPreset(permissions).preset).toBe("custom")
    })

    it("F7: the override count is the number of saved entries, redundant ones included", () => {
        // GET_ISSUE repeats the default. It still counts: the author set it deliberately, and it
        // survives a later change of default.
        const permissions: GatewayConnectionPermissions = {
            default: "ask",
            tools: {GET_ISSUE: "ask", DELETE_REPOSITORY: "deny"},
        }
        expect(readIntegrationPreset(permissions)).toEqual({preset: "custom", overrideCount: 2})
        expect(integrationPermissionSummary(permissions).label).toBe("Custom · 2")
    })

    it("F7: a single redundant entry never reads as Custom with a count of zero", () => {
        const permissions: GatewayConnectionPermissions = {
            default: "ask",
            tools: {GET_ISSUE: "ask"},
        }
        const {preset, overrideCount} = readIntegrationPreset(permissions)
        expect(preset).toBe("custom")
        expect(overrideCount).toBe(1)
    })

    it("falls back to the read-aware preset for a default no preset writes", () => {
        const unknown = {default: "escalate", tools: {}} as unknown as GatewayConnectionPermissions
        expect(readIntegrationPreset(unknown).preset).toBe(DEFAULT_INTEGRATION_PRESET)
    })

    it("labels a shared preset without a count", () => {
        expect(integrationPermissionSummary({default: "allow", tools: {}}).label).toBe("Allow all")
        expect(integrationPermissionSummary({default: "deny", tools: {}}).label).toBe("Denied")
        expect(integrationPermissionSummary({default: "ask", tools: {}}).label).toBe("Always asks")
        expect(integrationPermissionSummary({default: "inherit", tools: {}}).label).toBe(
            "Allow reads",
        )
    })
})

describe("switching between a preset and Custom", () => {
    it("F8: setting one tool permission switches the preset to Custom and keeps the others", () => {
        const current: GatewayConnectionPermissions = {
            default: "inherit",
            tools: {GET_ISSUE: "allow"},
        }
        const next = mergeToolPermission(current, "DELETE_REPOSITORY", "deny")
        expect(readIntegrationPreset(next).preset).toBe("custom")
        expect(next.tools).toEqual({GET_ISSUE: "allow", DELETE_REPOSITORY: "deny"})
        expect(next.default).toBe("inherit")
    })

    it("F8: a per-tool write does not mutate the policy it was given", () => {
        const current: GatewayConnectionPermissions = {default: "inherit", tools: {}}
        mergeToolPermission(current, "GET_ISSUE", "deny")
        expect(current.tools).toEqual({})
    })

    it("F8: setting the same tool twice replaces its value rather than adding an override", () => {
        const once = mergeToolPermission({default: "ask", tools: {}}, "GET_ISSUE", "allow")
        const twice = mergeToolPermission(once, "GET_ISSUE", "deny")
        expect(twice.tools).toEqual({GET_ISSUE: "deny"})
        expect(readIntegrationPreset(twice).overrideCount).toBe(1)
    })

    it("F9: picking a preset while on Custom clears the overrides", () => {
        const custom: GatewayConnectionPermissions = {
            default: "inherit",
            tools: {GET_ISSUE: "allow", DELETE_REPOSITORY: "deny"},
        }
        expect(write("allow_all", custom)).toEqual({default: "allow", tools: {}})
        expect(readIntegrationPreset(write("allow_all", custom)).overrideCount).toBe(0)
    })

    it("Custom is not writable — it leaves the saved policy untouched", () => {
        const custom: GatewayConnectionPermissions = {default: "deny", tools: {GET_ISSUE: "allow"}}
        expect(write("custom", custom)).toBe(custom)
    })
})
