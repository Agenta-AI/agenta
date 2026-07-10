/**
 * Unit tests for the object-level connected-app ("gateway") tool parser and its stable identity.
 *
 * Connected-app tools exist in two equivalent encodings — a canonical {type:"gateway", ...} object
 * (SDK/agent-authored) and a legacy OpenAI function tool whose function.name is the
 * tools__provider__integration__action__connection slug (UI-authored). parseGatewayTool normalizes
 * both into one view so the playground renders them identically. Runs under @agenta/entity-ui's own
 * vitest runner.
 */
import {describe, expect, it} from "vitest"

import {describeTool} from "../../src/DrillInView/SchemaControls/agentTemplate/itemDescriptors"
import {ITEM_KINDS} from "../../src/DrillInView/SchemaControls/agentTemplate/itemKinds"
import {gatewayToolIdentity, parseGatewayTool} from "../../src/DrillInView/SchemaControls/toolUtils"

const legacyTool = (name: string, extra: Record<string, unknown> = {}) => ({
    type: "function",
    function: {name},
    ...extra,
})

describe("parseGatewayTool", () => {
    it("reads a canonical object into fields with encoding:canonical", () => {
        const view = parseGatewayTool({
            type: "gateway",
            provider: "composio",
            integration: "slack",
            action: "OPEN_DM",
            connection: "slack-pnt",
            permission: "allow",
        })
        expect(view).toEqual({
            provider: "composio",
            integration: "slack",
            action: "OPEN_DM",
            connection: "slack-pnt",
            encoding: "canonical",
            permission: "allow",
        })
    })

    it("defaults provider to composio when absent on a canonical object", () => {
        const view = parseGatewayTool({
            type: "gateway",
            integration: "slack",
            action: "OPEN_DM",
            connection: "c",
        })
        expect(view?.provider).toBe("composio")
        expect(view?.encoding).toBe("canonical")
    })

    it("returns null when a canonical object is missing integration/action/connection", () => {
        expect(parseGatewayTool({type: "gateway", action: "OPEN_DM", connection: "c"})).toBeNull()
        expect(
            parseGatewayTool({type: "gateway", integration: "slack", connection: "c"}),
        ).toBeNull()
        expect(
            parseGatewayTool({type: "gateway", integration: "slack", action: "OPEN_DM"}),
        ).toBeNull()
    })

    it("reads a legacy function-name tool into fields with encoding:legacy", () => {
        const view = parseGatewayTool(legacyTool("tools__composio__slack__OPEN_DM__slack-pnt"))
        expect(view).toEqual({
            provider: "composio",
            integration: "slack",
            action: "OPEN_DM",
            connection: "slack-pnt",
            encoding: "legacy",
            permission: undefined,
        })
    })

    it("reads permission from the top level on a legacy tool", () => {
        const view = parseGatewayTool(
            legacyTool("tools__composio__slack__OPEN_DM__slack-pnt", {permission: "ask"}),
        )
        expect(view?.permission).toBe("ask")
        expect(view?.encoding).toBe("legacy")
    })

    it("returns null for non-gateway and junk inputs", () => {
        expect(parseGatewayTool(legacyTool("get_weather"))).toBeNull()
        expect(parseGatewayTool({type: "web_search_preview"})).toBeNull()
        expect(parseGatewayTool({type: "reference", slug: "wf"})).toBeNull()
        expect(parseGatewayTool(null)).toBeNull()
        expect(parseGatewayTool(undefined)).toBeNull()
        expect(parseGatewayTool([])).toBeNull()
        expect(parseGatewayTool("tools__composio__slack__OPEN_DM__c")).toBeNull()
        expect(parseGatewayTool(42)).toBeNull()
    })
})

describe("gatewayToolIdentity", () => {
    const canonical = {
        type: "gateway",
        provider: "composio",
        integration: "slack",
        action: "OPEN_DM",
        connection: "slack-pnt",
    }
    const legacy = legacyTool("tools__composio__slack__OPEN_DM__slack-pnt")

    it("gives the same identity for both encodings of the same tool", () => {
        const a = gatewayToolIdentity(parseGatewayTool(canonical)!)
        const b = gatewayToolIdentity(parseGatewayTool(legacy)!)
        expect(a).toBe(b)
    })

    it("differs when the connection or action differs", () => {
        const base = gatewayToolIdentity(parseGatewayTool(canonical)!)
        const otherConn = gatewayToolIdentity(
            parseGatewayTool({...canonical, connection: "slack-other"})!,
        )
        const otherAction = gatewayToolIdentity(
            parseGatewayTool({...canonical, action: "CLOSE_DM"})!,
        )
        expect(otherConn).not.toBe(base)
        expect(otherAction).not.toBe(base)
    })

    it("ignores permission — identity is policy-independent", () => {
        const allow = gatewayToolIdentity(parseGatewayTool({...canonical, permission: "allow"})!)
        const ask = gatewayToolIdentity(parseGatewayTool({...canonical, permission: "ask"})!)
        expect(allow).toBe(ask)
    })

    it("does not collide when a connection slug contains a dot", () => {
        // "slack.prod" as the connection must not be split into a differently-shaped identity.
        const dotted = gatewayToolIdentity(
            parseGatewayTool({...canonical, connection: "slack.prod"})!,
        )
        const shifted = gatewayToolIdentity(
            parseGatewayTool({...canonical, action: "OPEN_DM.slack", connection: "prod"})!,
        )
        expect(dotted).not.toBe(shifted)
    })
})

describe("describeTool on a canonical gateway object", () => {
    const descriptor = describeTool({
        type: "gateway",
        integration: "slack",
        action: "OPEN_DM",
        connection: "c",
    })

    it("humanizes the action into a prose (non-mono) name", () => {
        expect(descriptor.name.toLowerCase()).toBe("open dm")
        expect(descriptor.name).not.toBe("OPEN_DM")
        expect(descriptor.monoName).toBe(false)
    })

    it("tags the integration and labels it third-party, not built-in", () => {
        expect(descriptor.tags).toContain("slack")
        expect(descriptor.tags).not.toContain("built-in")
        expect(descriptor.typeLabel).toBe("third-party")
    })

    it("uses the connected-app subtitle", () => {
        expect(descriptor.subtitle.startsWith("Connected app tool")).toBe(true)
    })
})

describe("ITEM_KINDS.tool drill-in routing", () => {
    const canonical = {type: "gateway", integration: "slack", action: "OPEN_DM", connection: "c"}
    const builtin = {type: "web_search_preview"}

    it("opens a canonical gateway tool in the Form, JSON toggle available", () => {
        expect(ITEM_KINDS.tool.editView(canonical)).toBe("form")
        expect(ITEM_KINDS.tool.jsonOnly(canonical)).toBe(false)
    })

    it("keeps a bare builtin tool JSON-only (regression)", () => {
        expect(ITEM_KINDS.tool.editView(builtin)).toBe("json")
        expect(ITEM_KINDS.tool.jsonOnly(builtin)).toBe(true)
    })
})

describe("add-path identity (useAgentTools derivations, pure)", () => {
    // Mirror how useAgentTools builds `selectedGatewayIds` from the config's tools array.
    const selectedGatewayIds = (tools: unknown[]) =>
        new Set(
            tools
                .map((t) => {
                    const v = parseGatewayTool(t)
                    return v ? gatewayToolIdentity(v) : null
                })
                .filter((s): s is string => Boolean(s)),
        )

    // Mirror how the drawer builds an action's identity to compare against that set.
    const idForAction = gatewayToolIdentity({
        provider: "composio",
        integration: "slack",
        action: "OPEN_DM",
        connection: "c",
        encoding: "legacy",
    })

    it("a canonical tool in the config marks the matching drawer action as selected", () => {
        const tools = [{type: "gateway", integration: "slack", action: "OPEN_DM", connection: "c"}]
        expect(selectedGatewayIds(tools).has(idForAction)).toBe(true)
    })

    it("removeGatewayToolByIdentity removes exactly one of two duplicate entries", () => {
        const dup = {type: "gateway", integration: "slack", action: "OPEN_DM", connection: "c"}
        const tools: unknown[] = [dup, dup]
        // Same one-match filter the hook uses.
        let removed = false
        const next = tools.filter((t) => {
            if (removed) return true
            const v = parseGatewayTool(t)
            if (v && gatewayToolIdentity(v) === idForAction) {
                removed = true
                return false
            }
            return true
        })
        expect(next).toHaveLength(1)
    })
})
