// @vitest-environment jsdom
/**
 * The builder page's sources of an agent (task 27.2): the address (`?tab=agent:<id>`), the typed
 * `create_agent` and `edit_agent_config` results, the page context of the chat, and the browser
 * link. The results are recorded in the builder-backend shape (`status`, `agent`,
 * `revision: {id, version}`). The tab each source opens is in builderPageTabs.test.ts.
 */
import type {UIMessage} from "ai"
import {afterEach, describe, expect, it} from "vitest"

import {builderChatsKey, linkedAgentIdOf} from "@/features/builder/builderChatLink"
import {withContextLine} from "@/features/builder/pageContext"
import {
    BUILDER_LAYOUT_KEY,
    DEFAULT_BUILDER_PANE_LAYOUT,
    readBuilderPaneLayout,
    writeBuilderPaneLayout,
} from "@/features/builder-page/builderLayout"
import {parseTabParam} from "@/features/builder-page/builderTabs"
import {chatDayLabel} from "@/features/builder-page/chatDayLabel"
import {filterIdeas} from "@/features/builder-page/ideas"
import {agentResults, latestContextAgent} from "@/features/builder-page/paneAgent"

const toolPart = (
    name: string,
    toolCallId: string,
    output: unknown,
    state = "output-available",
) => ({type: `tool-${name}`, toolCallId, state, input: {}, output})

const assistant = (id: string, parts: unknown[]): UIMessage =>
    ({id, role: "assistant", parts}) as UIMessage

const userWithContext = (id: string, agent: {id: string; name: string}, words: string) =>
    ({
        id,
        role: "user",
        parts: [{type: "text", text: withContextLine({agent, has_unsaved_draft: false}, words)}],
        metadata: {display_content: words},
    }) as UIMessage

const created = {
    status: "created",
    agent: {id: "agent-lead-finder", name: "Lead finder", slug: "lead-finder"},
    revision: {id: "rev-1", version: "1"},
}
const committed = {
    status: "committed",
    agent: {id: "agent-email-writer", name: "Email writer", slug: "email-writer"},
    revision: {id: "rev-5", version: "5"},
}

afterEach(() => window.localStorage.clear())

describe("parseTabParam", () => {
    it("reads each kind and refuses anything else", () => {
        expect(parseTabParam("agent:abc")).toEqual({kind: "agent", id: "abc"})
        expect(parseTabParam("automation:s-1")).toEqual({kind: "automation", id: "s-1"})
        expect(parseTabParam("agent:")).toBeNull()
        expect(parseTabParam("thing:abc")).toBeNull()
        expect(parseTabParam(["agent:abc"])).toBeNull()
        expect(parseTabParam(undefined)).toBeNull()
    })
})

describe("agentResults", () => {
    it("lists each create_agent or edit_agent_config result with its agent, in order", () => {
        const messages = [
            assistant("m1", [toolPart("create_agent", "c1", created)]),
            assistant("m2", [
                {
                    ...toolPart("edit_agent_config", "c2", JSON.stringify(committed)),
                    input: {
                        operations: [
                            {operation: "set", target: ["parameters", "agent", "instructions"]},
                        ],
                    },
                },
            ]),
        ]
        expect(agentResults(messages)).toEqual([
            {
                toolCallId: "c1",
                agent: {id: "agent-lead-finder", name: "Lead finder"},
                saved: true,
                revisionId: "rev-1",
                changedSections: [],
            },
            {
                toolCallId: "c2",
                agent: {id: "agent-email-writer", name: "Email writer"},
                saved: true,
                revisionId: "rev-5",
                changedSections: ["instructions"],
            },
        ])
    })

    it("skips calls with no result, refusals and other tools", () => {
        const messages = [
            assistant("m1", [toolPart("create_agent", "c1", created)]),
            assistant("m2", [
                toolPart("edit_agent_config", "c2", undefined, "approval-requested"),
                toolPart("edit_agent_config", "c3", {error: {code: "refused"}}),
                toolPart("list_agents", "c4", {agents: [{id: "x"}]}),
            ]),
        ]
        expect(agentResults(messages).map((result) => result.toolCallId)).toEqual(["c1"])
        expect(agentResults([])).toEqual([])
    })
})

describe("latestContextAgent", () => {
    it("reads the agent of the latest user message with a context line", () => {
        const messages = [
            userWithContext("u1", {id: "agent-a", name: "Support triage"}, "make it shorter"),
            assistant("m1", []),
            {id: "u2", role: "user", parts: [{type: "text", text: "thanks"}]} as UIMessage,
        ]
        expect(latestContextAgent(messages)).toEqual({id: "agent-a", name: "Support triage"})
    })
})

describe("linkedAgentIdOf", () => {
    it("finds the agent the browser linked the chat to", () => {
        window.localStorage.setItem(
            builderChatsKey("user-1", "project-1"),
            JSON.stringify({"agent-a": ["chat-1", "chat-2"], "agent-b": ["chat-3"]}),
        )
        expect(linkedAgentIdOf("user-1", "project-1", "chat-3")).toBe("agent-b")
        expect(linkedAgentIdOf("user-1", "project-1", "chat-9")).toBeNull()
        expect(linkedAgentIdOf("user-2", "project-1", "chat-3")).toBeNull()
    })
})

describe("builder layout storage", () => {
    it("keeps the width, the hidden state and full screen, and clamps the width", () => {
        writeBuilderPaneLayout({width: 5000, hidden: true, fullScreen: false})
        expect(readBuilderPaneLayout()).toEqual({width: 1100, hidden: true, fullScreen: false})
        window.localStorage.setItem(BUILDER_LAYOUT_KEY, "not json")
        expect(readBuilderPaneLayout()).toEqual(DEFAULT_BUILDER_PANE_LAYOUT)
    })
})

describe("filterIdeas", () => {
    const ideas = [
        {
            category: "support" as const,
            title: "Triage support tickets",
            prompt: "Build an agent that reads tickets.",
        },
        {
            category: "sales" as const,
            title: "Write first emails",
            prompt: "Build an agent that writes emails.",
        },
    ]
    it("filters by category and by search in title or prompt", () => {
        expect(filterIdeas(ideas, "all", "")).toHaveLength(2)
        expect(filterIdeas(ideas, "sales", "")).toEqual([ideas[1]])
        expect(filterIdeas(ideas, "all", "TICKETS")).toEqual([ideas[0]])
        expect(filterIdeas(ideas, "support", "emails")).toEqual([])
    })
})

describe("chatDayLabel", () => {
    const words = {today: "Today", yesterday: "Yesterday"}
    const now = new Date(2026, 10, 20, 12, 0)
    it("says Today, Yesterday, a weekday in the last week, else a date", () => {
        expect(chatDayLabel(new Date(2026, 10, 20, 8).toISOString(), now, words)).toBe("Today")
        expect(chatDayLabel(new Date(2026, 10, 19, 23).toISOString(), now, words)).toBe("Yesterday")
        expect(chatDayLabel(new Date(2026, 10, 16, 9).toISOString(), now, words)).toMatch(/Mon/)
        expect(chatDayLabel(null, now, words)).toBe("")
    })
})
