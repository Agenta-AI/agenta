/** The MCP "Account" select: which options show. */
import {describe, expect, it} from "vitest"

import {mcpAccountOptions} from "../../src/DrillInView/SchemaControls/agentTemplate/accounts/accountOptions"

describe("MCP Account select", () => {
    it("offers each person's own sign-in for a server people can sign in to", () => {
        expect(
            mcpAccountOptions({source: "agent", personalAccounts: true, authMode: "oauth"}).map(
                (option) => option.title,
            ),
        ).toEqual(["Each person's own sign-in", "The project's sign-in"])
    })

    it("offers only the project's sign-in for an open server or with personal accounts off", () => {
        expect(
            mcpAccountOptions({source: "agent", personalAccounts: true, authMode: "none"}),
        ).toHaveLength(1)
        expect(
            mcpAccountOptions({source: "agent", personalAccounts: false, authMode: "oauth"}),
        ).toHaveLength(1)
    })
})
