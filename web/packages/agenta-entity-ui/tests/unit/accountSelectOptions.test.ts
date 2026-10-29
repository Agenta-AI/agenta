/**
 * The "Account" selects: which options show, and what each pick writes.
 */
import {describe, expect, it} from "vitest"

import {
    integrationAccountFromValue,
    integrationAccountOptions,
    integrationAccountValue,
    mcpAccountOptions,
} from "../../src/DrillInView/SchemaControls/agentTemplate/accounts/accountOptions"
import {agentSecretBinding} from "../../src/secret/agentSecretBinding"

const connections = [
    {slug: "gmail-main", name: "Gmail (main)"},
    {slug: "gmail-support", name: "Gmail (support)"},
]

describe("Composio Account select", () => {
    it("offers each person's default first, then each project connection", () => {
        const options = integrationAccountOptions({
            integrationName: "Gmail",
            projectConnections: connections,
            entry: {connection: "gmail-main"},
            personalAccounts: true,
        })
        expect(options.map((option) => option.title)).toEqual([
            "Each person's default Gmail",
            "Gmail (main)",
            "Gmail (support)",
        ])
    })

    it("hides each person's default when personal accounts are off", () => {
        const options = integrationAccountOptions({
            integrationName: "Gmail",
            projectConnections: connections,
            entry: {connection: "gmail-main"},
            personalAccounts: false,
        })
        expect(options.map((option) => option.value)).toEqual([
            "project:gmail-main",
            "project:gmail-support",
        ])
    })

    it("keeps a saved user value visible even when personal accounts are off", () => {
        const options = integrationAccountOptions({
            integrationName: "Gmail",
            projectConnections: connections,
            entry: {connection: "", accountSource: "user"},
            personalAccounts: false,
        })
        expect(options[0]?.value).toBe("user")
    })

    it("keeps a saved slug whose connection is gone", () => {
        const options = integrationAccountOptions({
            integrationName: "Gmail",
            projectConnections: connections,
            entry: {connection: "gmail-old"},
            personalAccounts: true,
        })
        expect(options.at(-1)).toEqual({value: "project:gmail-old", title: "gmail-old"})
    })

    it("round-trips the value of each choice to the account it writes", () => {
        expect(integrationAccountValue({connection: "", accountSource: "user"})).toBe("user")
        expect(integrationAccountFromValue("user")).toEqual({kind: "user"})
        expect(integrationAccountValue({connection: "gmail-main"})).toBe("project:gmail-main")
        expect(integrationAccountFromValue("project:gmail-main")).toEqual({
            kind: "project",
            slug: "gmail-main",
        })
    })
})

describe("MCP Account select", () => {
    it("offers each person's own sign-in for a server people can sign in to", () => {
        expect(
            mcpAccountOptions({source: "project", personalAccounts: true, authMode: "oauth"}).map(
                (option) => option.title,
            ),
        ).toEqual(["Each person's own sign-in", "The project's sign-in"])
    })

    it("offers only the project's sign-in for an open server or with personal accounts off", () => {
        expect(
            mcpAccountOptions({source: "project", personalAccounts: true, authMode: "none"}),
        ).toHaveLength(1)
        expect(
            mcpAccountOptions({source: "project", personalAccounts: false, authMode: "oauth"}),
        ).toHaveLength(1)
    })
})

describe("Attach a secret writes", () => {
    it("each person's own secret: account_source user and no slug", () => {
        expect(
            agentSecretBinding({secretSlug: "", accountSource: "user", envVar: "GITHUB_TOKEN"}),
        ).toEqual({
            secret: {account_source: "user"},
            binding: {type: "env", name: "GITHUB_TOKEN"},
        })
    })

    it("a project secret: its slug and no account_source", () => {
        expect(agentSecretBinding({secretSlug: "jira-token", envVar: "JIRA_TOKEN"})).toEqual({
            secret: {slug: "jira-token"},
            binding: {type: "env", name: "JIRA_TOKEN"},
        })
    })
})
