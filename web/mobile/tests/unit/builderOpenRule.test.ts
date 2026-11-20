// @vitest-environment jsdom
/**
 * Which builder chat the panel opens (task 24.1, the 2-day rule), the age labels of the lists,
 * and the chat link per user and project with the chats the query no longer returns.
 */
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import {afterEach, describe, expect, it, vi} from "vitest"

import {readBuilderChats, rememberBuilderChat} from "@/features/builder/builderChatLink"
import {chatAge, sessionToOpen} from "@/features/builder/openRule"
import {QUICK_ACTION_LABELS, READY_REQUESTS} from "@/features/builder/quickActions"
import type {BuilderChatRow} from "@/features/builder/useBuilderChatList"

const NOW = Date.parse("2026-11-20T12:00:00Z")
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString()
const row = (id: string, hours: number, running = false): BuilderChatRow => ({
    session_id: id,
    updated_at: hoursAgo(hours),
    flags: {is_running: running},
})

afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
})

describe("sessionToOpen", () => {
    it("opens the newest chat with activity in the last 2 days", () => {
        expect(sessionToOpen([row("a", 30), row("b", 50)], NOW)).toBe("a")
    })

    it("opens a new chat when the newest chat is older than 2 days", () => {
        expect(sessionToOpen([row("a", 72), row("b", 200)], NOW)).toBeNull()
    })

    it("opens an old chat that still runs, by its row or by liveness", () => {
        expect(sessionToOpen([row("a", 72, true)], NOW)).toBe("a")
        expect(sessionToOpen([row("a", 72)], NOW, (id) => id === "a")).toBe("a")
    })

    it("opens a new chat when no chat is stored or the row has no activity time", () => {
        expect(sessionToOpen([], NOW)).toBeNull()
        expect(sessionToOpen([{session_id: "a"}], NOW)).toBeNull()
    })

    it("treats exactly 48 hours as old", () => {
        expect(sessionToOpen([row("a", 48)], NOW)).toBeNull()
    })
})

describe("chatAge", () => {
    it("gives minutes, hours, then days", () => {
        expect(chatAge(hoursAgo(0.5), NOW)).toEqual({unit: "minute", count: 30})
        expect(chatAge(hoursAgo(5), NOW)).toEqual({unit: "hour", count: 5})
        expect(chatAge(hoursAgo(72), NOW)).toEqual({unit: "day", count: 3})
        expect(chatAge(null, NOW)).toBeNull()
    })
})

describe("the chat link", () => {
    it("keeps chats per user and project, newest first", () => {
        rememberBuilderChat("u1", "p1", "agent-1", "c1")
        rememberBuilderChat("u1", "p1", "agent-1", "c2")
        rememberBuilderChat("u2", "p1", "agent-1", "other-user")
        rememberBuilderChat("u1", "p2", "agent-1", "other-project")
        expect(readBuilderChats("u1", "p1", "agent-1")).toEqual(["c2", "c1"])
        expect(readBuilderChats("u2", "p1", "agent-1")).toEqual(["other-user"])
        expect(readBuilderChats("u1", "p2", "agent-1")).toEqual(["other-project"])
    })

    it("reads nothing and throws nothing when storage refuses", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("denied")
        })
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("denied")
        })
        expect(readBuilderChats("u1", "p1", "agent-1")).toEqual([])
        expect(() => rememberBuilderChat("u1", "p1", "agent-1", "c1")).not.toThrow()
    })
})

describe("the quick actions", () => {
    it("have a label, and three ready requests with a line each, in the catalog", () => {
        const keys = new Set(
            Object.keys(builderPanelCatalog.en).map((key) => `builder.panel.${key}`),
        )
        for (const [action, label] of Object.entries(QUICK_ACTION_LABELS)) {
            expect(keys.has(label)).toBe(true)
            const requests = READY_REQUESTS[action as keyof typeof READY_REQUESTS]
            expect(requests).toHaveLength(3)
            for (const {request, line} of requests) {
                expect(keys.has(request)).toBe(true)
                expect(keys.has(line)).toBe(true)
            }
        }
    })
})
