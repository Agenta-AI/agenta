import {describe, expect, it} from "vitest"

import {referenceToolSkin} from "../../../src/skin/referenceTools"
import {
    hasClientToolWidget,
    registerChatSkin,
    resolveApprovalDescriber,
    resolveActivityIcon,
    resolveClientToolWidget,
    resolveToolDisplay,
} from "../../../src/skin/registry"
import type {ClientToolWidget} from "../../../src/skin/types"

// Registrations mutate a module-level store shared across this file's tests (documented merge
// semantics: later registration wins per key), so every test below uses its own unique key(s) to
// stay independent of test order.
const widget = (id: string): ClientToolWidget => {
    const Widget = () => null
    Widget.displayName = id
    return Widget
}

describe("clientTools registry", () => {
    it("round-trips a render-kind registration", () => {
        const w = widget("A")
        registerChatSkin({clientTools: {byRenderKind: {rt_elicitation: w}}})
        expect(resolveClientToolWidget({toolName: "unrelated", renderKind: "rt_elicitation"})).toBe(
            w,
        )
    })

    it("round-trips a tool-name registration", () => {
        const w = widget("B")
        registerChatSkin({clientTools: {byToolName: {rt_tool_name_1: w}}})
        expect(resolveClientToolWidget({toolName: "rt_tool_name_1"})).toBe(w)
    })

    it("prefers render.kind over toolName when both are registered (real OSS precedence)", () => {
        const byKind = widget("kind")
        const byName = widget("name")
        registerChatSkin({
            clientTools: {
                byRenderKind: {rt_precedence_kind: byKind},
                byToolName: {rt_precedence_name: byName},
            },
        })
        const resolved = resolveClientToolWidget({
            toolName: "rt_precedence_name",
            renderKind: "rt_precedence_kind",
        })
        expect(resolved).toBe(byKind)
    })

    it("falls back to toolName when renderKind is absent", () => {
        const w = widget("fallback")
        registerChatSkin({clientTools: {byToolName: {rt_fallback_tool: w}}})
        expect(resolveClientToolWidget({toolName: "rt_fallback_tool"})).toBe(w)
    })

    it("does not reinterpret an explicit unknown render kind by tool name", () => {
        const w = widget("fallback")
        registerChatSkin({clientTools: {byToolName: {rt_explicit_tool: w}}})
        expect(
            resolveClientToolWidget({toolName: "rt_explicit_tool", renderKind: "rt_unregistered"}),
        ).toBeUndefined()
    })

    it("resolves to undefined for a completely unregistered tool", () => {
        expect(resolveClientToolWidget({toolName: "rt_never_registered"})).toBeUndefined()
    })

    it("hasClientToolWidget mirrors resolveClientToolWidget", () => {
        const w = widget("has")
        registerChatSkin({clientTools: {byToolName: {rt_has_tool: w}}})
        expect(hasClientToolWidget({toolName: "rt_has_tool"})).toBe(true)
        expect(hasClientToolWidget({toolName: "rt_has_tool_missing"})).toBe(false)
    })

    it("a later registration wins over an earlier one for the same key", () => {
        const first = widget("first")
        const second = widget("second")
        registerChatSkin({clientTools: {byToolName: {rt_wins: first}}})
        expect(resolveClientToolWidget({toolName: "rt_wins"})).toBe(first)
        registerChatSkin({clientTools: {byToolName: {rt_wins: second}}})
        expect(resolveClientToolWidget({toolName: "rt_wins"})).toBe(second)
    })
})

describe("approvals registry", () => {
    it("round-trips a describer and resolves it by tool name", () => {
        const describe_ = () => ({sentence: "Save it.", items: []})
        registerChatSkin({approvals: {ap_commit: describe_}})
        expect(resolveApprovalDescriber("ap_commit")).toBe(describe_)
    })

    it("resolves undefined for an unregistered tool name (the generic describer runs)", () => {
        expect(resolveApprovalDescriber("ap_never_registered")).toBeUndefined()
    })

    it("a later registration wins over an earlier one for the same tool name", () => {
        const first = () => ({sentence: "first", items: []})
        const second = () => ({sentence: "second", items: []})
        registerChatSkin({approvals: {ap_wins: first}})
        expect(resolveApprovalDescriber("ap_wins")).toBe(first)
        registerChatSkin({approvals: {ap_wins: second}})
        expect(resolveApprovalDescriber("ap_wins")).toBe(second)
    })
})

describe("toolDisplay registry — resolveToolDisplay fallback chain", () => {
    it("pins the gateway `tools__provider__integration__ACTION__connection` prettification", () => {
        const display = resolveToolDisplay("tools__composio__gmail__ADD_LABEL__b81")
        expect(display).toEqual({
            raw: "tools__composio__gmail__ADD_LABEL__b81",
            kind: "gateway",
            label: "Add label",
            // The sentence already names Gmail, so the chip would say it twice.
            source: undefined,
            sourceKey: "gmail",
            activity: {running: "Adding a Gmail label", done: "Added a Gmail label"},
            detail: undefined,
            summary: undefined,
            verb: {running: "Adding", done: "Added"},
            icon: "gateway",
        })
    })

    it("pins the mcp__{server}__{tool} prettification", () => {
        const display = resolveToolDisplay("mcp__linear__search_issues")
        expect(display).toEqual({
            raw: "mcp__linear__search_issues",
            kind: "mcp",
            label: "Search issues",
            // Named inside the sentence, so no chip. An MCP server is not a catalog
            // integration either, so there is nothing to look up.
            source: undefined,
            sourceKey: undefined,
            activity: {running: "Searching Linear issues", done: "Searched Linear issues"},
            detail: undefined,
            summary: undefined,
            verb: {running: "Searching", done: "Searched"},
            icon: "mcp",
        })
    })

    it("pins the plain-name title-case fallback with no source (platform kind)", () => {
        const display = resolveToolDisplay("search")
        expect(display).toEqual({
            raw: "search",
            kind: "platform",
            label: "Search",
            source: undefined,
            sourceKey: undefined,
            activity: {running: "Searching", done: "Searched"},
            detail: undefined,
            summary: undefined,
            verb: undefined,
            icon: "platform",
        })
    })

    it("merges a registered override with the parsed fallback, piece by piece", () => {
        const summary = (input: unknown) => (typeof input === "string" ? input : null)
        registerChatSkin({toolDisplay: {td_commit_like: {summary}}})
        const display = resolveToolDisplay("td_commit_like")
        // label/source/kind still come from the parsed name shape — only summary was overridden.
        expect(display.label).toBe("Td commit like")
        expect(display.kind).toBe("platform")
        expect(display.summary).toBe(summary)
    })

    it("a later registration wins over an earlier one for the same raw name", () => {
        registerChatSkin({toolDisplay: {td_wins: {label: "First"}}})
        expect(resolveToolDisplay("td_wins").label).toBe("First")
        registerChatSkin({toolDisplay: {td_wins: {label: "Second"}}})
        expect(resolveToolDisplay("td_wins").label).toBe("Second")
    })
})

describe("toolDisplay registry — built-in defaults", () => {
    it("words a harness builtin, and a registered summary merges onto the default", () => {
        expect(resolveToolDisplay("Read").activity.done).toBe("Read a file")
        const summary = () => "saved"
        registerChatSkin({toolDisplay: {read: {summary}}})
        const display = resolveToolDisplay("Read")
        // The registration contributed only `summary`; the default's wording survives.
        expect(display.activity.done).toBe("Read a file")
        expect(display.summary).toBe(summary)
    })

    it("reads the runtime pair as the app they reach", () => {
        // `search_tools` returns its JSON as a string; the first hit names the app and the tool.
        const found = JSON.stringify({
            results: [{integration: "github", tool: "FIND_PULL_REQUESTS", name: "Find PRs"}],
        })
        const search = resolveToolDisplay(
            "search_tools",
            {query: "list merged pull requests"},
            "GitHub",
            found,
        )
        expect(search.sourceKey).toBe("github")
        expect(search.kind).toBe("gateway")
        expect(search.icon).toBe("tool-search")
        expect(search.activity.done).toBe("Found GitHub pull requests")
        // Nothing matched: the row says what it did, not what the query asked for.
        const empty = resolveToolDisplay("search_tools", {query: "list merged pull requests"})
        expect(empty.sourceKey).toBeUndefined()
        expect(empty.activity.done).toBe("Searched for tools")
        // `run_tool` IS the tool's call, so it keeps every verb — it did create the release.
        const run = resolveToolDisplay(
            "run_tool",
            {integration: "github", tool: "CREATE_RELEASE", arguments: {}},
            "GitHub",
        )
        expect(run.sourceKey).toBe("github")
        expect(run.kind).toBe("gateway")
        expect(run.activity.done).toBe("Created a GitHub release")
    })

    it("puts the call's own detail in the secondary slot", () => {
        expect(resolveToolDisplay("Read", {file_path: "/repo/src/index.ts"}).detail).toBe(
            "index.ts",
        )
    })
})

describe("toolDisplay registry — activity icons", () => {
    it("names a builtin's glyph by verb and a platform op's by family", () => {
        expect(resolveToolDisplay("Read", {file_path: "a.ts"}).icon).toBe("file-read")
        expect(resolveToolDisplay("grep", {pattern: "x"}).icon).toBe("file-search")
        expect(resolveToolDisplay("bash", {command: "ls"}).icon).toBe("terminal")
        expect(resolveToolDisplay("Terminal", {command: "ls"}).icon).toBe("terminal")
        expect(resolveToolDisplay("Terminal", {command: "ls"}).activity.done).toBe("Ran a command")
        expect(resolveToolDisplay("__ag__pause_schedule").icon).toBe("schedule")
        expect(resolveToolDisplay("__ag__create_subscription").icon).toBe("trigger")
        expect(resolveToolDisplay("__ag__query_spans").icon).toBe("runs")
        expect(resolveToolDisplay("__ag__request_input").icon).toBe("ask")
        expect(resolveToolDisplay("__ag__request_secret").icon).toBe("secret")
        expect(resolveToolDisplay("request_secret").activity.done).toBe("Asked you for a secret")
    })

    it("falls back to the kind's glyph for anything unlisted", () => {
        expect(resolveActivityIcon("gateway", "tools__x__github__ISSUES_LIST__c1")).toBe("gateway")
        expect(resolveActivityIcon("mcp", "mcp__linear__anything")).toBe("mcp")
        expect(resolveActivityIcon("platform", "some_reference_tool")).toBe("platform")
    })

    it("lets a skin override the glyph without restating the wording", () => {
        registerChatSkin({toolDisplay: {td_icon_only: {icon: "deliveries"}}})
        const display = resolveToolDisplay("td_icon_only")
        expect(display.icon).toBe("deliveries")
        expect(display.label).toBe("Td icon only")
    })

    it("exposes the verb so a row can set the object apart", () => {
        expect(resolveToolDisplay("Read", {file_path: "a.ts"}).verb).toEqual({
            running: "Reading",
            done: "Read",
        })
        expect(resolveToolDisplay("__ag__commit_revision").verb).toEqual({
            running: "Saving",
            done: "Saved",
        })
    })
})

describe("toolDisplay registry — shell detail", () => {
    it("drops a leading cd that only positions the real command", () => {
        const display = resolveToolDisplay("bash", {
            command:
                "cd /tmp/agenta/mounts/01a03952-d243-7890-aafa-8f1c6a42672a/01a068a4-5015-7a60-b42b-9b026927faf0 && git clone https://github.com/x/y",
        })
        expect(display.detail).toBe("git clone https://github.com/x/y")
    })

    it("names a skill by its folder, not its manifest", () => {
        const display = resolveToolDisplay("Read", {
            file_path:
                "/tmp/agenta/mounts/p/m/agents/skills/5692802a/article-writing-feedback/SKILL.md",
        })
        expect(display.detail).toBe("article-writing-feedback skill")
        expect(resolveToolDisplay("Read", {file_path: "docs/README.md"}).detail).toBe("README.md")
    })

    it("names an attachment folder by the file inside it", () => {
        const path = "/tmp/agenta/mounts/p/m/attachments/01a05e23-7d4d-77b0-a889-9abde5dc8cab"
        expect(resolveToolDisplay("ls", {path}, undefined, "report (2).csv").detail).toBe(
            "report (2).csv",
        )
        expect(resolveToolDisplay("ls", {path}, undefined, "a.csv\nb.csv").detail).toBe(
            "an attachment",
        )
        expect(resolveToolDisplay("ls", {path}).detail).toBe("an attachment")
        expect(
            resolveToolDisplay("ls", {
                path: "/tmp/agenta/mounts/p/01a05e24-d3a6-77d3-ace4-10bf6f31364a",
            }).detail,
        ).toBe("the workspace")
        expect(
            resolveToolDisplay("ls", {
                path: "/tmp/agenta/mounts/p/01a05e24-d3a6-77d3-ace4-10bf6f31364a-agent",
            }).detail,
        ).toBe("the agent's files")
    })

    it("keeps a bare cd", () => {
        expect(resolveToolDisplay("bash", {command: "cd src"}).detail).toBe("cd src")
    })
})

describe("referenceToolSkin", () => {
    it("maps an agent's gateway tools to their app, leaving the wording name-derived", () => {
        const skin = referenceToolSkin({
            agent: {
                tools: [
                    {type: "gateway", name: "list-devto-articles", integration: "devto"},
                    {type: "gateway_connection", connection: {integration: "hackernews"}},
                    {type: "gateway", name: "", integration: "github"},
                ],
            },
        })
        expect(Object.keys(skin.toolDisplay ?? {})).toEqual(["list-devto-articles"])
        expect(skin.appHints).toEqual(["devto", "hackernews"])
        registerChatSkin(skin)
        const display = resolveToolDisplay("list-devto-articles", {per_page: 3}, "DEV Community")
        expect(display.kind).toBe("gateway")
        expect(display.sourceKey).toBe("devto")
        expect(display.icon).toBe("gateway")
        expect(display.activity.done).toBe("Checked devto articles")
    })

    it("wears the agent glyph on a subagent called by its slug", () => {
        registerChatSkin(
            referenceToolSkin({
                agent: {tools: [{type: "reference", slug: "agent-4ish", ref_by: "variant"}]},
            }),
        )
        expect(resolveToolDisplay("mcp__agenta-tools__agent-4ish").icon).toBe("agent")
    })

    it("reads a bare name that carries a connected app's slug as that app's tool", () => {
        registerChatSkin({appHints: ["hackernews"]})
        const display = resolveToolDisplay("get_hackernews_latest_posts")
        expect(display.sourceKey).toBe("hackernews")
        expect(display.kind).toBe("gateway")
        expect(display.activity.done).toBe("Got hackernews latest posts")
        // Our own ops and unrelated names are untouched.
        expect(resolveToolDisplay("__ag__query_spans").sourceKey).toBeUndefined()
        expect(resolveToolDisplay("search").sourceKey).toBeUndefined()
    })
})
