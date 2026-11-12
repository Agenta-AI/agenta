/**
 * Regression for #5781: an automation the agent creates must show in the playground without a
 * reload. The create runs on the server, so the settled tool part is the only browser signal.
 * These tests drive the hook the way `useAgentConversation` does and read the real query cache.
 */
import {createElement} from "react"

import {sessionFileActivityAtomFamily} from "@agenta/entities/session"
import {getHostQueryClient} from "@agenta/shared/api"
import {act} from "@testing-library/react"
import type {UIMessage} from "ai"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {useSettledToolEffects} from "../../../src/hooks/useSettledToolEffects"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const SCHEDULES = ["triggers", "schedules", "project-1"]
const SUBSCRIPTIONS = ["triggers", "subscriptions", "project-1"]

const user = (text: string): UIMessage =>
    ({id: `u-${text}`, role: "user", parts: [{type: "text", text}]}) as unknown as UIMessage

const assistant = (id: string, parts: Record<string, unknown>[]): UIMessage =>
    ({id, role: "assistant", parts}) as unknown as UIMessage

const tool = (name: string, toolCallId: string, state = "output-available", input?: unknown) => ({
    type: `tool-${name}`,
    toolCallId,
    state,
    input: input ?? {},
})

const Probe = ({sessionId, messages}: {sessionId: string; messages: UIMessage[]}) => {
    useSettledToolEffects({sessionId, messages})
    return null
}

let root: Root

const render = (sessionId: string, messages: UIMessage[]) =>
    act(() => root.render(createElement(Probe, {sessionId, messages})))

const isStale = (queryKey: string[]) =>
    getHostQueryClient().getQueryState(queryKey)?.isInvalidated ?? null

/** Seeds both lists as fresh, the state the config pane holds before the agent runs. */
const seedLists = () => {
    const qc = getHostQueryClient()
    qc.setQueryData(SCHEDULES, {schedules: []})
    qc.setQueryData(SUBSCRIPTIONS, {subscriptions: []})
}

beforeEach(() => {
    getHostQueryClient().clear()
    seedLists()
    root = createRoot(document.createElement("div"))
})

afterEach(() => {
    act(() => root.unmount())
})

describe("useSettledToolEffects: trigger lists", () => {
    it("refreshes the schedules list when create_schedule settles mid-stream", () => {
        render("s1", [user("schedule it")])
        render("s1", [
            user("schedule it"),
            assistant("a1", [tool("create_schedule", "c1", "input-available")]),
        ])
        expect(isStale(SCHEDULES)).toBe(false)

        render("s1", [user("schedule it"), assistant("a1", [tool("create_schedule", "c1")])])
        expect(isStale(SCHEDULES)).toBe(true)
        expect(isStale(SUBSCRIPTIONS)).toBe(false)
    })

    it("refreshes when the Claude harness wraps the op in our MCP server name", () => {
        render("s1", [assistant("a1", [tool("mcp__agenta-tools__remove_schedule", "c1")])])
        expect(isStale(SCHEDULES)).toBe(true)
    })

    it("refreshes the subscriptions list for an event automation", () => {
        render("s1", [assistant("a1", [tool("create_subscription", "c1")])])
        expect(isStale(SUBSCRIPTIONS)).toBe(true)
        expect(isStale(SCHEDULES)).toBe(false)
    })

    it.each(["remove_schedule", "pause_schedule", "resume_schedule"])(
        "refreshes the schedules list after %s",
        (name) => {
            render("s1", [assistant("a1", [tool(name, "c1")])])
            expect(isStale(SCHEDULES)).toBe(true)
        },
    )

    it("does not refresh for a failed create or a read-only op", () => {
        render("s1", [
            assistant("a1", [
                tool("create_schedule", "c1", "output-error"),
                tool("list_schedules", "c2"),
                tool("test_subscription", "c3"),
            ]),
        ])
        expect(isStale(SCHEDULES)).toBe(false)
        expect(isStale(SUBSCRIPTIONS)).toBe(false)
    })

    it("refreshes once per call while the rest of the turn keeps streaming", () => {
        const settled = tool("create_schedule", "c1")
        render("s1", [assistant("a1", [settled])])
        expect(isStale(SCHEDULES)).toBe(true)

        seedLists()
        render("s1", [assistant("a1", [settled, {type: "text", text: "Done."}])])
        render("s1", [assistant("a1", [settled, {type: "text", text: "Done. It runs Mondays."}])])
        expect(isStale(SCHEDULES)).toBe(false)
    })

    it("refreshes for a second create in the same turn", () => {
        const first = tool("create_schedule", "c1")
        render("s1", [assistant("a1", [first])])
        seedLists()
        render("s1", [assistant("a1", [first, tool("create_schedule", "c2")])])
        expect(isStale(SCHEDULES)).toBe(true)
    })

    it("does not refresh when the last message is the user's", () => {
        render("s1", [assistant("a1", [tool("create_schedule", "c1")])])
        seedLists()
        render("s1", [assistant("a1", [tool("create_schedule", "c1")]), user("thanks")])
        expect(isStale(SCHEDULES)).toBe(false)
    })
})

describe("useSettledToolEffects: switching sessions", () => {
    it("refreshes when returning to a session whose create settled while another was open", () => {
        render("s1", [
            user("schedule it"),
            assistant("a1", [tool("create_schedule", "c1", "input-available")]),
        ])
        render("s2", [assistant("b1", [{type: "text", text: "hello"}])])
        expect(isStale(SCHEDULES)).toBe(false)

        render("s1", [user("schedule it"), assistant("a1", [tool("create_schedule", "c1")])])
        expect(isStale(SCHEDULES)).toBe(true)
    })

    it("refreshes again when a session that already refreshed is reopened", () => {
        const history = [assistant("a1", [tool("create_schedule", "c1")])]
        render("s1", history)
        seedLists()
        render("s2", [assistant("b1", [{type: "text", text: "hello"}])])
        expect(isStale(SCHEDULES)).toBe(false)

        render("s1", history)
        expect(isStale(SCHEDULES)).toBe(true)
    })

    it("does not refresh when switching to a session with no trigger op", () => {
        render("s1", [assistant("a1", [{type: "text", text: "hi"}])])
        render("s2", [assistant("b1", [tool("list_schedules", "c9"), tool("bash", "c10")])])
        expect(isStale(SCHEDULES)).toBe(false)
        expect(isStale(SUBSCRIPTIONS)).toBe(false)
    })

    it("acts on a call id that two sessions share, once in each session", () => {
        render("s1", [assistant("a1", [tool("create_schedule", "same")])])
        seedLists()
        render("s2", [assistant("b1", [tool("create_subscription", "same")])])
        expect(isStale(SUBSCRIPTIONS)).toBe(true)
    })
})

describe("useSettledToolEffects: file activity", () => {
    it("still records a settled file write for the session's drives", () => {
        render("files-1", [
            assistant("a1", [tool("Write", "w1", "output-available", {file_path: "notes/a.md"})]),
        ])
        const entries = getDefaultStore().get(sessionFileActivityAtomFamily("files-1"))
        expect(entries.map((e) => [e.toolCallId, e.path])).toEqual([["w1", "notes/a.md"]])
        expect(isStale(SCHEDULES)).toBe(false)
    })
})
