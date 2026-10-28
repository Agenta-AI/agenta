import {describe, expect, it, vi} from "vitest"

import {
    audienceBody,
    audienceOf,
    behaviorFromGrants,
    buildAgentChannelsActions,
    rulesForBehavior,
    type ChannelsClientLike,
} from "../../src/channels/actions"

const allow = (kind: string) => ({id: `a-${kind}`, effect: "allow", kind})
const deny = (kind: string) => ({id: `d-${kind}`, effect: "deny", kind})
const allowSpace = (spaceId: string) => ({id: `s-${spaceId}`, effect: "allow", space_id: spaceId})

describe("Where the agent answers", () => {
    it("reads no grant as everywhere", () => {
        expect(behaviorFromGrants("slack", [])).toEqual({dm: true, group: true, channels: null})
    })

    it("reads today's switches", () => {
        expect(
            behaviorFromGrants("slack", [allow("private"), deny("group"), deny("topic")]),
        ).toEqual({dm: true, group: false, channels: null})
        expect(
            behaviorFromGrants("slack", [deny("private"), allow("group"), allow("topic")]),
        ).toEqual({dm: false, group: true, channels: null})
    })

    it("reads single-channel allow rules back as chosen channels", () => {
        expect(
            behaviorFromGrants("slack", [allow("private"), allowSpace("s1"), allowSpace("s2")]),
        ).toEqual({dm: true, group: true, channels: ["s1", "s2"]})
        // DMs off: only the channels
        expect(behaviorFromGrants("slack", [deny("private"), allowSpace("s1")])).toEqual({
            dm: false,
            group: true,
            channels: ["s1"],
        })
        // nothing checked, DMs on
        expect(behaviorFromGrants("slack", [allow("private")])).toEqual({
            dm: true,
            group: true,
            channels: [],
        })
    })

    it("reads a space's default-agent rule as a chosen channel, as the backend counts it", () => {
        expect(
            behaviorFromGrants("slack", [
                allow("private"),
                {...allowSpace("s1"), flags: {is_default: true}},
            ]),
        ).toEqual({dm: true, group: true, channels: ["s1"]})
    })

    it("keeps DMs off with nothing checked from reading as everywhere", () => {
        const rules = rulesForBehavior("slack", {dm: false, group: true, channels: []})
        expect(rules).toEqual([{effect: "deny", kind: "private"}])
    })

    it("writes only these channels as allow rules with no deny", () => {
        const rules = rulesForBehavior("slack", {dm: true, group: true, channels: ["s1"]})
        expect(rules).toEqual([
            {effect: "allow", kind: "private"},
            {effect: "allow", spaceId: "s1"},
        ])
        expect(rules.some((rule) => rule.effect === "deny")).toBe(false)
    })

    it("writes nothing for everywhere, and today's kind rules for the switches", () => {
        expect(rulesForBehavior("slack", {dm: true, group: true, channels: null})).toEqual([])
        expect(rulesForBehavior("slack", {dm: true, group: false, channels: null})).toEqual([
            {effect: "allow", kind: "private"},
            {effect: "deny", kind: "group"},
            {effect: "deny", kind: "topic"},
        ])
        expect(rulesForBehavior("telegram", {dm: false, group: true, channels: null})).toEqual([
            {effect: "deny", kind: "private"},
            {effect: "allow", kind: "group"},
        ])
    })

    it("round-trips every state", () => {
        const states = [
            {dm: true, group: true, channels: null},
            {dm: false, group: true, channels: null},
            {dm: true, group: false, channels: null},
            {dm: false, group: false, channels: null},
            {dm: true, group: true, channels: ["s1", "s2"]},
            {dm: false, group: true, channels: ["s1"]},
            {dm: true, group: true, channels: []},
            {dm: false, group: true, channels: []},
            {dm: true, group: false, channels: ["s1"]},
        ]
        for (const state of states) {
            const grants = rulesForBehavior("slack", state).map((rule) =>
                "spaceId" in rule
                    ? allowSpace(rule.spaceId)
                    : rule.effect === "allow"
                      ? allow(rule.kind)
                      : deny(rule.kind),
            )
            expect(behaviorFromGrants("slack", grants)).toEqual(state)
        }
    })

    it("saves by deleting only what changed, a space deny and an unchecked default included", async () => {
        const grants = [
            {id: "g1", effect: "allow", kind: "private"},
            {id: "g2", effect: "deny", kind: "group"},
            {id: "g3", effect: "deny", kind: "topic"},
            {id: "g4", effect: "allow", space_id: "s9", flags: {is_default: true}},
            {id: "g5", effect: "deny", space_id: "s1"},
        ]
        const client = {
            queryChannelAgents: vi.fn().mockResolvedValue({
                agents: [{id: "agent-row", flags: {is_default: true}}],
            }),
            queryChannelGrants: vi.fn().mockResolvedValue({grants}),
            deleteChannelGrant: vi.fn().mockResolvedValue({}),
            createChannelGrant: vi.fn().mockResolvedValue({}),
        } as unknown as ChannelsClientLike
        const actions = buildAgentChannelsActions({
            client,
            projectId: () => "project",
            appId: "app",
            resolveAgentName: () => null,
            hostedSlackInstallUrl: () => null,
        })
        await actions.writeBehavior("slack", "connection", {
            dm: true,
            group: true,
            channels: ["s1"],
        })
        const deleted = vi
            .mocked(client.deleteChannelGrant)
            .mock.calls.map(([body]) => (body as {grant_id: string}).grant_id)
        expect(deleted.sort()).toEqual(["g2", "g3", "g4", "g5"])
        const created = vi
            .mocked(client.createChannelGrant)
            .mock.calls.map(([body]) => (body as {grant: Record<string, unknown>}).grant)
        expect(created).toEqual([
            {agent_id: "agent-row", effect: "allow", space_id: "s1", data: {}},
        ])
        // the new rule lands before any old one goes, so the agent never has no rule at all
        const firstDelete = Math.min(
            ...vi.mocked(client.deleteChannelGrant).mock.invocationCallOrder,
        )
        const lastCreate = Math.max(
            ...vi.mocked(client.createChannelGrant).mock.invocationCallOrder,
        )
        expect(lastCreate).toBeLessThan(firstDelete)
    })
})

describe("Who the agent answers", () => {
    it("reads the people list and its labels from the binding", () => {
        expect(
            audienceOf({
                data: {
                    audience: {
                        senders: ["U1", 42],
                        labels: {U1: {name: "Ana", email: "ana@example.com"}},
                    },
                },
            }),
        ).toEqual([
            {id: "U1", name: "Ana", email: "ana@example.com"},
            {id: "42", name: null, email: null},
        ])
        expect(audienceOf({data: {}})).toEqual([])
    })

    it("writes the ids and the labels together", () => {
        expect(
            audienceBody([
                {id: "U1", name: "Ana", email: "ana@example.com"},
                {id: "42", name: null, email: null},
            ]),
        ).toEqual({
            senders: ["U1", "42"],
            labels: {U1: {name: "Ana", email: "ana@example.com"}},
        })
    })
})
