import type {SessionStream} from "@agenta/entities/session"
import type {Workflow} from "@agenta/entities/workflow"
import {describe, expect, it} from "vitest"

import {agentLastUsed, sortAgentsByLastUsed} from "./agentsSource"

// `sessionAgentId` only accepts UUID references, so session-derived tests need real ones.
const ALPHA = "11111111-1111-4111-8111-111111111111"

const agent = (id: string, stamps: Partial<Workflow> = {}): Workflow =>
    ({id, name: id, ...stamps}) as Workflow

const session = (agentId: string | null, activity: string | null): SessionStream =>
    ({
        session_id: `session-${agentId}-${activity}`,
        references: agentId ? [{id: agentId, key: "workflow"}] : [],
        updated_at: activity,
    }) as SessionStream

const ids = (workflows: readonly Workflow[]) => workflows.map((workflow) => workflow.id)

describe("agentLastUsed", () => {
    it("keeps the newest activity per agent, and the local stamp when it leads", () => {
        const lastUsed = agentLastUsed(
            [session(ALPHA, "2026-08-01T10:00:00Z"), session(ALPHA, "2026-08-03T10:00:00Z")],
            {[ALPHA]: Date.parse("2026-08-04T10:00:00Z")},
        )

        expect(lastUsed.get(ALPHA)).toBe(Date.parse("2026-08-04T10:00:00Z"))
    })

    // A session with no turns names no agent, so it is activity for nobody.
    it("ignores rows with no agent or no usable stamp", () => {
        expect(agentLastUsed([session(null, "2026-08-05T10:00:00Z")]).size).toBe(0)
        expect(agentLastUsed([session(ALPHA, "not-a-date")]).has(ALPHA)).toBe(false)
    })
})

describe("sortAgentsByLastUsed", () => {
    it("orders by session activity, newest first", () => {
        const sorted = sortAgentsByLastUsed(
            [agent("old"), agent("new"), agent("mid")],
            new Map([
                ["old", 1],
                ["new", 3],
                ["mid", 2],
            ]),
        )

        expect(ids(sorted)).toEqual(["new", "mid", "old"])
    })

    // Creating an agent counts as using it, so a fresh one opens above agents that ran earlier.
    it("falls back to the agent's own stamp when it has no usage", () => {
        const sorted = sortAgentsByLastUsed(
            [
                agent("used", {created_at: "2026-07-01T10:00:00Z"}),
                agent("brand-new", {created_at: "2026-08-10T10:00:00Z"}),
                agent("edited", {updated_at: "2026-08-09T10:00:00Z"}),
                agent("undated"),
            ],
            new Map([["used", Date.parse("2026-08-08T10:00:00Z")]]),
        )

        expect(ids(sorted)).toEqual(["brand-new", "edited", "used", "undated"])
    })

    it("keeps the source order for equal timestamps", () => {
        const sorted = sortAgentsByLastUsed(
            [agent("first"), agent("second"), agent("third")],
            new Map([
                ["first", 7],
                ["second", 7],
                ["third", 7],
            ]),
        )

        expect(ids(sorted)).toEqual(["first", "second", "third"])
    })

    // The group renders `refs.slice(0, maxItems)`, so the cut must land on a sorted list.
    it("leaves the five most recent agents in the sidebar's visible slots", () => {
        const workflows = Array.from({length: 8}, (_, index) => agent(`agent-${index}`))
        const lastUsed = new Map(workflows.map((workflow, index) => [workflow.id, index]))

        const visible = sortAgentsByLastUsed(workflows, lastUsed).slice(0, 5)

        expect(ids(visible)).toEqual(["agent-7", "agent-6", "agent-5", "agent-4", "agent-3"])
    })
})
