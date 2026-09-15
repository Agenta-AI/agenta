/**
 * What a new connection is called, and which names the project will not take.
 *
 * Display names are unique per project, and the API compares them on a normalized form:
 * every character outside `[A-Za-z0-9_]` becomes an underscore. The client checks the same
 * way on purpose — a laxer check lets someone submit a name the API then refuses, and a
 * stricter one refuses a name the API would have taken.
 */
import {describe, expect, it} from "vitest"

import {
    connectionNameProblem,
    hostnameLabel,
    normalizeConnectionName,
    suggestConnectionName,
} from "../../src/mcpEndpoint/core/connectionName"

describe("hostnameLabel", () => {
    it("reads the host out of a URL", () => {
        expect(hostnameLabel("https://mcp.acme.test/sse?x=1")).toBe("mcp.acme.test")
    })

    it("drops a leading www", () => {
        expect(hostnameLabel("https://www.acme.test/")).toBe("acme.test")
    })

    it("says nothing about a string that is not a URL", () => {
        expect(hostnameLabel("not a url")).toBe("")
    })
})

describe("normalizeConnectionName", () => {
    it("replaces every character the platform does not keep", () => {
        expect(normalizeConnectionName("Acme Tools")).toBe("Acme_Tools")
        expect(normalizeConnectionName("acme.tools-1")).toBe("acme_tools_1")
    })

    it("trims first, so trailing space is not a distinct name", () => {
        expect(normalizeConnectionName(" Acme ")).toBe("Acme")
    })
})

describe("suggestConnectionName", () => {
    it("prefers the name the server gave for itself", () => {
        expect(
            suggestConnectionName({serverName: "Acme Tools", url: "https://mcp.acme.test/"}),
        ).toBe("Acme Tools")
    })

    it("falls back to the hostname, which is all a protected server offers before consent", () => {
        expect(suggestConnectionName({serverName: null, url: "https://mcp.acme.test/"})).toBe(
            "mcp.acme.test",
        )
    })

    it("still produces something when there is neither", () => {
        expect(suggestConnectionName({url: ""})).toBe("MCP server")
    })

    it("distinguishes a second account at the same server", () => {
        expect(
            suggestConnectionName({
                serverName: "Acme Tools",
                url: "https://mcp.acme.test/",
                existingNames: ["Acme Tools"],
            }),
        ).toBe("Acme Tools (secondary)")
    })

    it("keeps counting past the ordinals it has words for", () => {
        expect(
            suggestConnectionName({
                serverName: "Acme",
                url: "https://mcp.acme.test/",
                existingNames: ["Acme", "Acme (secondary)"],
            }),
        ).toBe("Acme (3)")
    })

    it("never suggests a name the API would refuse", () => {
        // "Acme-Tools" normalizes onto "Acme_Tools", so the bare name is already taken.
        const suggestion = suggestConnectionName({
            serverName: "Acme Tools",
            url: "https://mcp.acme.test/",
            existingNames: ["Acme-Tools"],
        })

        expect(suggestion).toBe("Acme Tools (secondary)")
        expect(connectionNameProblem({name: suggestion, existingNames: ["Acme-Tools"]})).toBeNull()
    })
})

describe("connectionNameProblem", () => {
    it("accepts a name nothing else uses", () => {
        expect(connectionNameProblem({name: "Acme", existingNames: ["Beta"]})).toBeNull()
    })

    it("asks for a name rather than accepting an empty one", () => {
        expect(connectionNameProblem({name: "   ", existingNames: []})).toBe("Enter a name.")
    })

    it("refuses a duplicate", () => {
        expect(connectionNameProblem({name: "Acme", existingNames: ["Acme"]})).toContain(
            "already uses this name",
        )
    })

    it("refuses one that only looks different", () => {
        // The API sees both as "Acme_Tools", so accepting this would submit a name the
        // server rejects.
        expect(
            connectionNameProblem({name: "Acme Tools", existingNames: ["Acme-Tools"]}),
        ).toContain("already uses this name")
    })

    it("does not call a connection a duplicate of itself when renaming", () => {
        expect(
            connectionNameProblem({
                name: "Acme",
                existingNames: ["Acme", "Beta"],
                currentName: "Acme",
            }),
        ).toBeNull()
    })

    it("still refuses a rename onto another connection's name", () => {
        expect(
            connectionNameProblem({
                name: "Beta",
                existingNames: ["Acme", "Beta"],
                currentName: "Acme",
            }),
        ).toContain("already uses this name")
    })
})
