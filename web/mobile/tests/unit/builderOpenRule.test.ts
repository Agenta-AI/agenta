// @vitest-environment jsdom
/**
 * Which builder chat the panel opens (task 24.1, the 2-day rule) and the age labels of the lists.
 */
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import {describe, expect, it} from "vitest"

import {chatAge, sessionToOpen} from "@/features/builder/openRule"
import {READY_REQUESTS} from "@/features/builder/quickActions"
import type {BuilderChatRow} from "@/features/builder/useBuilderChatList"

const NOW = Date.parse("2026-11-20T12:00:00Z")
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString()
const row = (id: string, hours: number, running = false): BuilderChatRow => ({
    session_id: id,
    updated_at: hoursAgo(hours),
    flags: {is_running: running},
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

describe("the ready requests of the panel", () => {
    it("are four, each with a title, a line and a request that names the agent", () => {
        const en = builderPanelCatalog.en as Record<string, string>
        const text = (key: string) => en[key.replace("builder.panel.", "")]
        expect(READY_REQUESTS).toHaveLength(4)
        for (const {title, line, request} of READY_REQUESTS) {
            expect(text(title)).toBeTruthy()
            expect(text(line)).toBeTruthy()
            expect(text(request)).toContain("{{agent}}")
        }
    })
})
