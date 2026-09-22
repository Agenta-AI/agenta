/**
 * Which default-permission preset an MCP server's saved policy reads back as.
 *
 * Every case here is a way the select could say something the wire does not carry. The two that
 * mattered were one shape before decision 45: a server nobody had configured read back as "Ask for
 * write and delete", whose help line promises that read-only tools run automatically, and picking
 * that preset wrote nothing at all. The absence has its own preset now, and that one writes the
 * shape it describes.
 */
import {describe, expect, it} from "vitest"

import {askWritesPolicy, type McpServerPolicy} from "@agenta/entities/mcpEndpoint"

import {INTEGRATION_PRESETS} from "../../src/DrillInView/SchemaControls/integrationPolicy"
import {MCP_PRESETS, readMcpPreset} from "../../src/mcpEndpoint/mcpPresets"

const READ_ONLY = ["get_issue", "list_issues"]

/** The tool list in hand, which is the only state in which a preset can be named for certain. */
const loaded = {names: READ_ONLY, arriving: false}
/** The list still on its way. */
const arriving = {names: null, arriving: true}
/** No list, and none coming: a read that failed does not come back. */
const absent = {names: null, arriving: false}

describe("MCP_PRESETS", () => {
    it("adds one preset to the shared five, for the state the wire spells as an absence", () => {
        expect(MCP_PRESETS.map((preset) => preset.value)).toEqual([
            "always_ask",
            "ask_writes",
            "allow_all",
            "deny_all",
            "follow_agent",
            "custom",
        ])
    })

    it("names the absent state the way the spec names it, and says what it does", () => {
        const follow = MCP_PRESETS.find((preset) => preset.value === "follow_agent")

        expect(follow?.label).toBe("Follow agent policy")
        expect(follow?.help).toBe("Follows agent policy for every tool")
    })

    it("takes the five shared labels from the shared table rather than restating them", () => {
        // Four presets appear in both drawers. Restating their copy here is how the two would
        // drift after the next wording change.
        for (const preset of MCP_PRESETS) {
            const shared = INTEGRATION_PRESETS.find((def) => def.value === preset.value)
            if (!shared) continue
            expect({label: preset.label, help: preset.help}).toEqual({
                label: shared.label,
                help: shared.help,
            })
        }
    })

    it("leaves the Integrations table untouched, at five presets", () => {
        expect(INTEGRATION_PRESETS.map((def) => def.value)).toEqual([
            "always_ask",
            "ask_writes",
            "allow_all",
            "deny_all",
            "custom",
        ])
    })

    it("shows Custom below a divider and refuses to let anyone pick it", () => {
        const custom = MCP_PRESETS.find((preset) => preset.value === "custom")

        expect(custom?.disabled).toBe(true)
        expect(custom?.separatorBefore).toBe(true)
    })
})

describe("readMcpPreset", () => {
    it("reads a policy with nothing written as the preset named for that", () => {
        expect(readMcpPreset({}, loaded)).toEqual({preset: "follow_agent", overrideCount: 0})
    })

    it("does not read it as the preset that promises read-only tools run automatically", () => {
        expect(readMcpPreset({}, loaded).preset).not.toBe("ask_writes")
    })

    it("reads each whole-server value as its own preset", () => {
        expect(readMcpPreset({permission: "ask"}, loaded).preset).toBe("always_ask")
        expect(readMcpPreset({permission: "allow"}, loaded).preset).toBe("allow_all")
        expect(readMcpPreset({permission: "deny"}, loaded).preset).toBe("deny_all")
    })

    it("reads the shape the ask-writes preset writes back as that preset", () => {
        expect(readMcpPreset(askWritesPolicy(READ_ONLY), loaded)).toEqual({
            preset: "ask_writes",
            overrideCount: 2,
        })
    })

    it("reads a table an author built by hand as Custom, with its count", () => {
        const byHand: McpServerPolicy = {
            permission: "allow",
            tool_permissions: {delete_issue: "deny"},
            new_tool_permission: "allow",
        }

        expect(readMcpPreset(byHand, loaded)).toEqual({preset: "custom", overrideCount: 1})
    })

    it("reads an ask-writes shape that names the wrong tools as Custom", () => {
        // An always-ask server with one write allowed by hand carries the same three fields. It is
        // not this preset, and calling it one would promise that every read runs automatically.
        const askedPlusOne: McpServerPolicy = {
            permission: "ask",
            tool_permissions: {delete_issue: "allow"},
            new_tool_permission: "ask",
        }

        expect(readMcpPreset(askedPlusOne, loaded).preset).toBe("custom")
    })

    it("names no preset at all while the list that would settle it is on its way", () => {
        // Not "Ask for write and delete": naming it makes its help line's promise, and without the
        // list nobody has checked which tools this policy allows.
        expect(readMcpPreset(askWritesPolicy(READ_ONLY), arriving)).toEqual({
            preset: null,
            overrideCount: 2,
        })
    })

    it("names no preset for a policy allowing the most destructive tool a server has", () => {
        // The adversarial case, and the reason the pending state exists. These three fields are
        // the ones the preset writes, so a shape-only read called this "Ask for write and delete"
        // and told a reader that its read-only tools run automatically.
        const destructive: McpServerPolicy = {
            permission: "ask",
            tool_permissions: {delete_issue: "allow"},
            new_tool_permission: "ask",
        }

        expect(readMcpPreset(destructive, arriving).preset).toBeNull()
        // And once the list settles it, the honest answer, which claims nothing about reads.
        expect(readMcpPreset(destructive, loaded).preset).toBe("custom")
    })

    it("falls back to the conservative read once no list is coming", () => {
        // A tool list that failed is not on its way back, and a control that waits forever is its
        // own untruth. Custom says there are per-tool rules and claims nothing about which.
        expect(readMcpPreset(askWritesPolicy(READ_ONLY), absent).preset).toBe("custom")
    })

    it("answers every other policy the same with the list or without it", () => {
        // Pending must never stand in for an answer this could give. Only the ask-writes shape is
        // unknowable; a policy that is not that shape reads the same in all three states.
        for (const policy of [
            {},
            {permission: "allow"} as McpServerPolicy,
            {permission: "deny"} as McpServerPolicy,
            {permission: "ask"} as McpServerPolicy,
            {permission: "allow", tool_permissions: {delete_issue: "deny"}} as McpServerPolicy,
        ]) {
            const settled = readMcpPreset(policy, loaded)
            expect(readMcpPreset(policy, arriving)).toEqual(settled)
            expect(readMcpPreset(policy, absent)).toEqual(settled)
            expect(settled.preset).not.toBeNull()
        }
    })
})
