import {describe, expect, it} from "vitest"

import {
    hasUserItems,
    readUserItems,
    userItemKey,
    userItemsParameters,
} from "../../src/accountChoice/items"

const gmailUser = {
    type: "gateway_connection",
    connection: {provider: "composio", integration: "gmail", account_source: "user"},
    policy: {permissions: {default: "allow", tools: {}}},
}
const hubspotProject = {
    type: "gateway_connection",
    connection: {provider: "composio", integration: "hubspot", slug: "hubspot-sales"},
}
const linearUser = {
    name: "linear",
    connection: {type: "gateway", namespace: "custom", slug: "linear", account_source: "user"},
}
const githubUser = {
    secret: {account_source: "user"},
    binding: {type: "env", name: "GITHUB_TOKEN"},
}
const jiraProject = {secret: {slug: "jira-token"}, binding: {type: "env", name: "JIRA_TOKEN"}}

describe("userItemKey", () => {
    it("builds the server's key shape", () => {
        expect(userItemKey("app_connection", "gmail")).toBe("app_connection:user/gmail")
        expect(userItemKey("secret", "GITHUB_TOKEN")).toBe("secret:user/GITHUB_TOKEN")
    })
})

describe("readUserItems", () => {
    it("keeps only the items with account_source user", () => {
        const items = readUserItems({
            instructions: "x",
            tools: [gmailUser, hubspotProject, {type: "function", name: "f"}],
            mcps: [linearUser, {connection: {type: "gateway", slug: "notion"}}],
            sandbox: {kind: "daytona", credentials: [githubUser, jiraProject]},
        })
        expect(items.tools).toEqual([gmailUser])
        expect(items.mcps).toEqual([linearUser])
        expect(items.credentials).toEqual([githubUser])
        expect(items.llm).toBeNull()
    })

    it("never throws on a malformed configuration", () => {
        expect(readUserItems(null).tools).toEqual([])
        expect(readUserItems({tools: "x", mcps: {}, sandbox: []}).mcps).toEqual([])
    })
})

describe("hasUserItems", () => {
    it("is false for an agent that uses only project accounts", () => {
        expect(hasUserItems({tools: [hubspotProject], sandbox: {credentials: [jiraProject]}})).toBe(
            false,
        )
    })

    it("is true for any one user item", () => {
        expect(hasUserItems({tools: [gmailUser]})).toBe(true)
        expect(hasUserItems({mcps: [linearUser]})).toBe(true)
        expect(hasUserItems({sandbox: {credentials: [githubUser]}})).toBe(true)
        expect(
            hasUserItems({llm: {connection: {mode: "self_managed", account_source: "user"}}}),
        ).toBe(true)
    })
})

describe("userItemsParameters", () => {
    it("is null without user items", () => {
        expect(userItemsParameters({tools: [hubspotProject]})).toBeNull()
    })

    it("carries only the user items, so other edits keep the same parameters", () => {
        const a = userItemsParameters({instructions: "a", tools: [gmailUser, hubspotProject]})
        const b = userItemsParameters({instructions: "b", tools: [gmailUser, hubspotProject]})
        expect(a).toEqual({agent: {tools: [gmailUser], mcps: [], sandbox: {credentials: []}}})
        expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })
})
