// @vitest-environment jsdom
/**
 * The page context of a builder message (task 8.1, SC5) and the chat link in browser storage (SC8).
 * The model reads one context line before the person's words; the words stay `display_content`.
 */
import {outboundUserParts} from "@agenta/chat/assets"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    builderChatsKey,
    readBuilderChats,
    rememberBuilderChat,
} from "@/features/builder/builderChatLink"
import {
    CONTEXT_LINE_PREFIX,
    pagePartKey,
    parseContextLine,
    resolvePagePart,
    withContextLine,
    type PageContext,
} from "@/features/builder/pageContext"

const agent = {id: "agent-1", name: "Support triage"}
const onSession: PageContext = {agent, has_unsaved_draft: false}
const onConfiguration: PageContext = {
    agent,
    page: {
        kind: "configuration",
        tab: "agent",
        item: {list: "skills", key: "ticket-triage", name: "ticket-triage"},
    },
    has_unsaved_draft: true,
}

describe("the context line", () => {
    it("puts one line before the words on the session screen: the agent only", () => {
        const text = withContextLine(onSession, "Make the replies shorter")
        const [line, blank, words] = text.split("\n")
        expect(line.startsWith(`${CONTEXT_LINE_PREFIX} `)).toBe(true)
        expect(JSON.parse(line.slice(CONTEXT_LINE_PREFIX.length + 1))).toEqual(onSession)
        expect(blank).toBe("")
        expect(words).toBe("Make the replies shorter")
    })

    it("carries the configuration part and the unsaved draft on Configuration", () => {
        const text = withContextLine(onConfiguration, "Why is this skill slow?")
        expect(parseContextLine(text, "Why is this skill slow?")).toEqual(onConfiguration)
    })

    it("round-trips the agent, the tab and the item", () => {
        const words = "Add a refund step"
        const parsed = parseContextLine(withContextLine(onConfiguration, words), words)
        expect(parsed?.agent).toEqual(agent)
        expect(parsed?.page).toEqual(onConfiguration.page)
    })

    it("keeps a name with a line break on one line", () => {
        const context = {...onSession, agent: {id: "a", name: "Two\nlines"}}
        const text = withContextLine(context, "hi")
        expect(text.split("\n\n")[0].includes("\n")).toBe(false)
        expect(parseContextLine(text, "hi")?.agent.name).toBe("Two\nlines")
    })

    it("reads only the part before the typed words", () => {
        const typed = `${CONTEXT_LINE_PREFIX} {"agent":{"id":"x","name":"Fake"}}`
        // A message with no line, whose words look like one, has no context.
        expect(parseContextLine(typed, typed)).toBeNull()
        // With a real line, the line the browser wrote wins.
        expect(parseContextLine(withContextLine(onSession, typed), typed)?.agent).toEqual(agent)
    })

    it("treats an unknown version or a broken line as no context", () => {
        expect(parseContextLine(`[agenta page context v2] {}\n\nhi`, "hi")).toBeNull()
        expect(parseContextLine(`${CONTEXT_LINE_PREFIX} {oops\n\nhi`, "hi")).toBeNull()
        expect(parseContextLine("hi", "hi")).toBeNull()
    })

    it("sends the line to the model and the words as display_content", () => {
        const words = "Make the replies shorter"
        const executionText = withContextLine(onSession, words)
        const parts = outboundUserParts({text: words, executionText})
        expect(parts).toEqual([{type: "text", text: executionText}])
    })
})

describe("the builder chat link", () => {
    afterEach(() => {
        window.localStorage.clear()
        vi.restoreAllMocks()
    })

    it("keeps chats per user and project, newest first", () => {
        rememberBuilderChat("u1", "p1", "agent-1", "chat-a")
        rememberBuilderChat("u1", "p1", "agent-1", "chat-b")
        rememberBuilderChat("u1", "p1", "agent-1", "chat-a")
        expect(readBuilderChats("u1", "p1", "agent-1")).toEqual(["chat-a", "chat-b"])
        expect(window.localStorage.getItem(builderChatsKey("u1", "p1"))).toContain("chat-a")
        expect(readBuilderChats("u2", "p1", "agent-1")).toEqual([])
        expect(readBuilderChats("u1", "p2", "agent-1")).toEqual([])
    })

    it("keeps a chat with its first agent", () => {
        rememberBuilderChat("u1", "p1", "agent-1", "chat-a")
        rememberBuilderChat("u1", "p1", "agent-2", "chat-a")
        expect(readBuilderChats("u1", "p1", "agent-1")).toEqual(["chat-a"])
        expect(readBuilderChats("u1", "p1", "agent-2")).toEqual([])
    })

    it("works when the browser refuses storage", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("denied")
        })
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("denied")
        })
        expect(() => rememberBuilderChat("u1", "p1", "agent-1", "chat-a")).not.toThrow()
        expect(readBuilderChats("u1", "p1", "agent-1")).toEqual([])
    })

    it("ignores stored values of the wrong shape", () => {
        window.localStorage.setItem(builderChatsKey("u1", "p1"), '{"agent-1": "chat-a"}')
        expect(readBuilderChats("u1", "p1", "agent-1")).toEqual([])
    })
})

describe("the page part", () => {
    const configuration = {
        kind: "configuration" as const,
        tab: "agent" as const,
        item: {list: "skills" as const, key: "ticket-triage", name: "ticket-triage"},
    }

    it("takes the Configuration part over the page session", () => {
        expect(
            resolvePagePart(configuration, {id: "s1", pending: false, row: {name: "A"}}),
        ).toEqual(configuration)
    })

    it("gives the session id and name on a session", () => {
        expect(
            resolvePagePart(null, {
                id: "s1",
                pending: false,
                row: {name: "Charged twice for March"},
            }),
        ).toEqual({kind: "session", session: {id: "s1", name: "Charged twice for March"}})
    })

    it("gives the session id with no name while the row loads", () => {
        expect(resolvePagePart(null, {id: "s1", pending: true, row: undefined})).toEqual({
            kind: "session",
            session: {id: "s1"},
        })
    })

    it("gives no page part for a session with no row yet, or off a session", () => {
        expect(resolvePagePart(null, {id: "s1", pending: false, row: null})).toBeNull()
        expect(resolvePagePart(null, null)).toBeNull()
    })

    it("keys a page part by what it names", () => {
        expect(pagePartKey({kind: "session", session: {id: "s1", name: "A"}})).toBe(
            pagePartKey({kind: "session", session: {id: "s1"}}),
        )
        expect(pagePartKey(configuration)).not.toBe(
            pagePartKey({kind: "configuration", tab: "agent"}),
        )
        expect(pagePartKey(null)).toBeNull()
    })

    it("round-trips a line with the session part, and a line with the agent only", () => {
        const onSessionPage: PageContext = {
            agent,
            page: {kind: "session", session: {id: "s1", name: "Charged twice for March"}},
            has_unsaved_draft: false,
        }
        const sent = withContextLine(onSessionPage, "Why medium?")
        expect(parseContextLine(sent, "Why medium?")).toEqual(onSessionPage)
        const removed = withContextLine({agent, has_unsaved_draft: false}, "Why medium?")
        expect(parseContextLine(removed, "Why medium?")?.page).toBeUndefined()
    })
})
