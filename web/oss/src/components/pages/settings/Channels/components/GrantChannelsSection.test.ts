import type {AgentaApi} from "@agentaai/api-client"
import {describe, expect, it} from "vitest"

import {channelGrantFor, matchConfiguredSpace, needsInviteWarning} from "./GrantChannelsSection"

function space(overrides: Partial<AgentaApi.ChannelSpace> = {}): AgentaApi.ChannelSpace {
    return {
        id: "space-1",
        connection_id: "conn-1",
        kind: "topic",
        external_key: "key-1",
        data: {external_locator: {team: "T1", channel: "C1"}},
        ...overrides,
    }
}

function candidate(
    overrides: Partial<AgentaApi.ChannelSpaceCandidate> = {},
): AgentaApi.ChannelSpaceCandidate {
    return {
        kind: "topic",
        external_locator: {team: "T1", channel: "C1"},
        ...overrides,
    }
}

function grant(overrides: Partial<AgentaApi.ChannelGrant> = {}): AgentaApi.ChannelGrant {
    return {
        id: "g1",
        agent_id: "agent-1",
        effect: "allow",
        space_id: "space-1",
        data: {},
        ...overrides,
    }
}

describe("matchConfiguredSpace", () => {
    it("matches a candidate to the configured space with the same locator", () => {
        const spaces = [space()]
        expect(matchConfiguredSpace(candidate(), spaces)?.id).toBe("space-1")
    })

    it("finds nothing when no configured space shares the locator", () => {
        const spaces = [space({data: {external_locator: {team: "T1", channel: "OTHER"}}})]
        expect(matchConfiguredSpace(candidate(), spaces)).toBeUndefined()
    })

    it("finds nothing against an empty configured list — not yet configured", () => {
        expect(matchConfiguredSpace(candidate(), [])).toBeUndefined()
    })
})

describe("channelGrantFor", () => {
    it("finds the grant naming this agent and space", () => {
        expect(channelGrantFor([grant()], "agent-1", "space-1")?.id).toBe("g1")
    })

    it("returns undefined with no space_id — nothing to match yet", () => {
        expect(channelGrantFor([grant()], "agent-1", undefined)).toBeUndefined()
    })

    it("returns undefined for a different agent even on the same space", () => {
        expect(channelGrantFor([grant()], "agent-2", "space-1")).toBeUndefined()
    })
})

describe("needsInviteWarning", () => {
    it("warns on an allowed topic channel — the invite is separate from the grant", () => {
        expect(needsInviteWarning("topic", "allow")).toBe(true)
    })

    it("warns on an allowed group chat the same way", () => {
        expect(needsInviteWarning("group", "allow")).toBe(true)
    })

    it("never warns for a private DM — Slack needs no /invite for one", () => {
        expect(needsInviteWarning("private", "allow")).toBe(false)
    })

    it("never warns when there is no grant at all", () => {
        expect(needsInviteWarning("topic", undefined)).toBe(false)
    })

    it("never warns on a denied channel — nothing to invite the bot into", () => {
        expect(needsInviteWarning("topic", "deny")).toBe(false)
    })
})
