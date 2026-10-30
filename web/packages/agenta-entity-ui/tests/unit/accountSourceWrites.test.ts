/**
 * The item JSON each "Account" choice writes (accounts package contract, section 5.1): a "user"
 * Composio entry has no slug, a project one has no account_source, a "user" MCP item keeps its
 * slug.
 */
import {describe, expect, it} from "vitest"

import {
    readMcpAccountSource,
    withMcpAccountSource,
} from "../../src/DrillInView/SchemaControls/agentTemplate/mcpRail"
import {
    buildGatewayConnectionEntry,
    parseGatewayConnection,
    setGatewayConnectionAccount,
    setGatewayConnectionPermissions,
} from "../../src/DrillInView/SchemaControls/toolUtils"

const target = {provider: "composio", integration: "gmail"}
const projectEntry = {
    type: "gateway_connection",
    connection: {provider: "composio", integration: "gmail", slug: "gmail-main"},
    policy: {permissions: {default: "allow", tools: {GMAIL_SEND: "ask"}}, note: "kept"},
}

describe("Composio entry account", () => {
    it("each person: writes account_source user and drops the slug", () => {
        const [entry] = setGatewayConnectionAccount([projectEntry], target, {accountSource: "user"}) as [
            Record<string, Record<string, unknown>>,
        ]
        expect(entry.connection).toEqual({
            provider: "composio",
            integration: "gmail",
            account_source: "user",
        })
        // The policy, and fields the parser does not model, ride along.
        expect(entry.policy).toEqual(projectEntry.policy)
    })

    it("a project connection: writes its slug and drops account_source", () => {
        const user = setGatewayConnectionAccount([projectEntry], target, {accountSource: "user"})
        const [entry] = setGatewayConnectionAccount(user, target, {
            accountSource: "agent",
            slug: "gmail-support",
        }) as [Record<string, Record<string, unknown>>]
        expect(entry.connection).toEqual({
            provider: "composio",
            integration: "gmail",
            slug: "gmail-support",
        })
    })

    it("parses a user entry with no slug, and keeps it user through a permission edit", () => {
        const user = setGatewayConnectionAccount([projectEntry], target, {accountSource: "user"})
        expect(parseGatewayConnection(user[0])).toMatchObject({
            connection: "",
            accountSource: "user",
        })
        const edited = setGatewayConnectionPermissions(user, target, {default: "ask", tools: {}})
        expect((edited[0] as {connection: unknown}).connection).toEqual({
            provider: "composio",
            integration: "gmail",
            account_source: "user",
        })
    })

    it("still refuses a project entry with no slug", () => {
        expect(
            parseGatewayConnection({
                type: "gateway_connection",
                connection: {provider: "composio", integration: "gmail"},
            }),
        ).toBeNull()
    })

    it("builds a new user entry without a slug", () => {
        const entry = buildGatewayConnectionEntry({
            ...target,
            connection: "",
            accountSource: "user",
            permissions: {default: "inherit", tools: {}},
        })
        expect(entry.connection).toEqual({...target, account_source: "user"})
    })

    it("leaves tools alone when the integration has no entry", () => {
        const tools = [projectEntry]
        expect(
            setGatewayConnectionAccount(tools, {provider: "composio", integration: "x"}, {
                kind: "user",
            }),
        ).toBe(tools)
    })
})

describe("MCP item account", () => {
    const item = {
        name: "linear",
        connection: {type: "gateway", namespace: "custom", slug: "linear"},
        policy: {tools: {mode: "all"}},
    }

    it("each person: writes account_source user and keeps the slug", () => {
        const user = withMcpAccountSource(item, "user")
        expect(user.connection).toEqual({
            type: "gateway",
            namespace: "custom",
            slug: "linear",
            account_source: "user",
        })
        expect(readMcpAccountSource(user)).toBe("user")
        expect(user.policy).toEqual(item.policy)
    })

    it("the project's sign-in: drops account_source", () => {
        const back = withMcpAccountSource(withMcpAccountSource(item, "user"), "agent")
        expect(back.connection).toEqual(item.connection)
        expect(readMcpAccountSource(back)).toBe("agent")
    })

    it("refuses user on a server outside the custom namespace", () => {
        const builtin = {...item, connection: {...item.connection, namespace: "builtin"}}
        expect(withMcpAccountSource(builtin, "user")).toBe(builtin)
    })
})
