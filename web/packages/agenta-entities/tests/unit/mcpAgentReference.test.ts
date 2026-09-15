/**
 * The two things a saved agent item carries: the slug it resolves at run time, and the tool
 * prefix the model sees. They are separate on purpose, so renaming a connection in settings
 * cannot rename the tools an already-saved agent calls.
 */
import {describe, expect, it} from "vitest"

import {
    buildMcpConnectionRef,
    isLegacyMcpItem,
    readMcpConnectionSlug,
    RESERVED_TOOL_PREFIX,
    toolPrefixFromName,
} from "../../src/mcpEndpoint/core/agentReference"

describe("toolPrefixFromName", () => {
    it("keeps a name that is already usable", () => {
        expect(toolPrefixFromName("acme-tools")).toBe("acme-tools")
    })

    it("replaces what a tool name cannot carry", () => {
        expect(toolPrefixFromName("Acme Tools (main)")).toBe("Acme-Tools-main-")
    })

    it("does not start with punctuation", () => {
        expect(toolPrefixFromName("  ...acme")).toBe("acme")
    })

    it("caps the length", () => {
        expect(toolPrefixFromName("a".repeat(200))).toHaveLength(128)
    })

    it("refuses a name with nothing usable in it rather than inventing one", () => {
        expect(toolPrefixFromName("   ")).toBeNull()
        expect(toolPrefixFromName("!!!")).toBeNull()
    })

    it("refuses the prefix the platform reserves for itself", () => {
        expect(toolPrefixFromName(RESERVED_TOOL_PREFIX)).toBeNull()
    })
})

describe("buildMcpConnectionRef", () => {
    it("writes the gateway shape, never the old http one", () => {
        expect(buildMcpConnectionRef("acme")).toEqual({
            type: "gateway",
            namespace: "custom",
            slug: "acme",
        })
    })
})

describe("readMcpConnectionSlug", () => {
    it("reads the slug off a gateway reference", () => {
        expect(
            readMcpConnectionSlug({
                name: "Acme-Tools",
                connection: {type: "gateway", namespace: "custom", slug: "acme-tools-7mx"},
            }),
        ).toBe("acme-tools-7mx")
    })

    it("still reads a configuration saved under the older shape", () => {
        // There the item had no slug of its own: `name` was it.
        expect(
            readMcpConnectionSlug({
                name: "exa",
                connection: {type: "http", url: "https://mcp.exa.test/"},
            }),
        ).toBe("exa")
    })

    it("prefers an explicit slug over the name when both are present", () => {
        expect(
            readMcpConnectionSlug({
                name: "exa",
                connection: {type: "gateway", slug: "exa-2"},
            }),
        ).toBe("exa-2")
    })

    it("says nothing about an item that points nowhere", () => {
        expect(readMcpConnectionSlug({name: "exa"})).toBeUndefined()
        expect(readMcpConnectionSlug(null)).toBeUndefined()
    })
})

describe("isLegacyMcpItem", () => {
    it("recognizes the shape that is read but no longer written", () => {
        expect(isLegacyMcpItem({connection: {type: "http", url: "https://x.test/"}})).toBe(true)
        expect(isLegacyMcpItem({connection: {type: "gateway", slug: "acme"}})).toBe(false)
    })
})
