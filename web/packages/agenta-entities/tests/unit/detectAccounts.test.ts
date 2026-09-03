import {describe, expect, it} from "vitest"

import {AGENT_TEMPLATES, type AgentStarterTemplate} from "../../src/workflow/agentTemplates"
import {
    detectAccounts,
    detectAccountsFromTemplate,
    detectAccountsFromText,
    requiredAccounts,
} from "../../src/workflow/detectAccounts"

const slugs = (accounts: {slug: string}[]) => accounts.map((account) => account.slug)

describe("detectAccountsFromText", () => {
    it("matches provider names", () => {
        expect(slugs(detectAccountsFromText("Post a summary to Slack"))).toEqual(["slack"])
    })

    it("is case-insensitive and matches multi-word labels", () => {
        expect(slugs(detectAccountsFromText("block time on google calendar"))).toEqual([
            "googlecalendar",
        ])
    })

    it("matches aliases", () => {
        expect(slugs(detectAccountsFromText("summarize every pull request"))).toEqual(["github"])
        expect(slugs(detectAccountsFromText("triage my inbox"))).toEqual(["gmail"])
    })

    it("offers every candidate when an alias is ambiguous", () => {
        expect(slugs(detectAccountsFromText("file a ticket for each bug")).sort()).toEqual([
            "jira",
            "linear",
        ])
    })

    it("orders by first mention, not catalogue order", () => {
        expect(slugs(detectAccountsFromText("read Slack threads and open GitHub issues"))).toEqual([
            "slack",
            "github",
        ])
    })

    it("requires whole-word boundaries", () => {
        expect(detectAccountsFromText("a hub for the team")).toEqual([])
        expect(detectAccountsFromText("order some slacks and shirts")).toEqual([])
    })

    it("rejects the ordinary-English readings of provider names", () => {
        expect(detectAccountsFromText("solve linear algebra problems")).toEqual([])
        expect(detectAccountsFromText("explain the notion that agents are tools")).toEqual([])
        expect(detectAccountsFromText("cut some slack for late replies")).toEqual([])
    })

    it("still matches those names in a real mention", () => {
        expect(slugs(detectAccountsFromText("open a Linear issue"))).toEqual(["linear"])
        expect(slugs(detectAccountsFromText("write it to the Notion database"))).toEqual(["notion"])
        expect(slugs(detectAccountsFromText("post to the Slack channel"))).toEqual(["slack"])
    })

    it("never marks a text match as required", () => {
        for (const account of detectAccountsFromText("watch GitHub and notify Slack")) {
            expect(account.required).toBe(false)
            expect(account.origin).toBe("text")
        }
    })

    it("gives a detected row no scope line — the card's lead says where they came from once", () => {
        for (const account of detectAccountsFromText("watch GitHub and notify Slack")) {
            expect(account.why).toBe("")
        }
    })

    it("returns nothing for an empty or featureless description", () => {
        expect(detectAccountsFromText("")).toEqual([])
        expect(detectAccountsFromText("   ")).toEqual([])
        expect(detectAccountsFromText("an agent that writes poems")).toEqual([])
    })
})

describe("detectAccountsFromTemplate", () => {
    const template = AGENT_TEMPLATES.find((entry) => entry.requiredIntegrations.length > 0)

    it("marks every declared integration required and carries its scope line", () => {
        expect(template).toBeDefined()
        const accounts = detectAccountsFromTemplate(template as AgentStarterTemplate)
        expect(accounts).toHaveLength(
            (template as AgentStarterTemplate).requiredIntegrations.length,
        )
        for (const [index, account] of accounts.entries()) {
            const declared = (template as AgentStarterTemplate).requiredIntegrations[index]
            expect(account.required).toBe(true)
            expect(account.origin).toBe("template")
            expect(account.slug).toBe(declared.slug)
            expect(account.why).toBe(declared.scope)
        }
    })

    it("gives every account a label and a subtitle", () => {
        for (const entry of AGENT_TEMPLATES) {
            for (const account of detectAccountsFromTemplate(entry)) {
                expect(account.label, `${entry.key}/${account.slug}`).toBeTruthy()
                expect(account.why, `${entry.key}/${account.slug}`).toBeTruthy()
            }
        }
    })
})

describe("detectAccounts", () => {
    const template: AgentStarterTemplate = {
        ...(AGENT_TEMPLATES[0] as AgentStarterTemplate),
        requiredIntegrations: [{slug: "github", scope: "Read issues and comment", tools: []}],
    }

    it("puts template accounts first and text matches after", () => {
        const accounts = detectAccounts({
            description: "post a digest to Slack",
            template,
        })
        expect(slugs(accounts)).toEqual(["github", "slack"])
        expect(accounts[0].required).toBe(true)
        expect(accounts[1].required).toBe(false)
    })

    it("dedupes by slug, with the template entry winning", () => {
        const accounts = detectAccounts({
            description: "watch GitHub issues",
            template,
        })
        expect(slugs(accounts)).toEqual(["github"])
        expect(accounts[0].origin).toBe("template")
        expect(accounts[0].why).toBe("Read issues and comment")
    })

    it("works with either input alone", () => {
        expect(slugs(detectAccounts({template}))).toEqual(["github"])
        expect(slugs(detectAccounts({description: "notify Slack"}))).toEqual(["slack"])
        expect(detectAccounts({})).toEqual([])
    })

    it("handles a template that declares nothing", () => {
        const bare = {...template, requiredIntegrations: []}
        expect(slugs(detectAccounts({description: "notify Slack", template: bare}))).toEqual([
            "slack",
        ])
    })
})

describe("requiredAccounts", () => {
    it("selects only the gating accounts", () => {
        const accounts = detectAccounts({
            description: "post a digest to Slack",
            template: {
                ...(AGENT_TEMPLATES[0] as AgentStarterTemplate),
                requiredIntegrations: [{slug: "github", scope: "Read issues", tools: []}],
            },
        })
        expect(slugs(requiredAccounts(accounts))).toEqual(["github"])
    })

    it("is empty for a pure free-text detection, so create is never gated on a guess", () => {
        expect(requiredAccounts(detectAccountsFromText("watch GitHub and notify Slack"))).toEqual(
            [],
        )
    })
})
