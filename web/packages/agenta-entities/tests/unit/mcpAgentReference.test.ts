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
        expect(toolPrefixFromName("acme_tools")).toBe("acme_tools")
    })

    it("renders the prefix the way the platform does", () => {
        // Matches `tool_prefix` in api/oss/src/core/gateways/mcps/service.py: strip, then
        // every character outside [A-Za-z0-9_] becomes an underscore, case preserved. A
        // second spelling here would put the agent's tools under a name nothing else agrees
        // with, and would disagree with the form the project deduplicates names on.
        expect(toolPrefixFromName("Acme Tools (main)")).toBe("Acme_Tools__main_")
        expect(toolPrefixFromName("acme-tools")).toBe("acme_tools")
    })

    it("strips before it renders, so padding is not underscores", () => {
        expect(toolPrefixFromName("  Acme  ")).toBe("Acme")
    })

    it("caps the length", () => {
        expect(toolPrefixFromName("a".repeat(200))).toHaveLength(128)
    })

    it("refuses a name with nothing usable in it rather than inventing one", () => {
        expect(toolPrefixFromName("   ")).toBeNull()
    })

    it("refuses the prefix the runner reserves for its own tools, either spelling", () => {
        expect(toolPrefixFromName(RESERVED_TOOL_PREFIX)).toBeNull()
        expect(toolPrefixFromName("agenta tools")).toBeNull()
        expect(toolPrefixFromName("agenta_tools")).toBeNull()
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
