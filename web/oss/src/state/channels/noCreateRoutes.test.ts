import {describe, expect, it} from "vitest"

import * as channelsApi from "./api"

/**
 * The API exposes no create route for threads, inbox events, or outbox events
 * (they are written only by routing and by workers). This package must not
 * invent a client-side workaround — pinned here as the absence of any
 * create-shaped export for these three entities.
 */
describe("no create routes for read-only debugging surfaces", () => {
    it("exposes no createChannelThread", () => {
        expect((channelsApi as Record<string, unknown>).createChannelThread).toBeUndefined()
    })

    it("exposes no createChannelInboxEvent", () => {
        expect((channelsApi as Record<string, unknown>).createChannelInboxEvent).toBeUndefined()
    })

    it("exposes no createChannelOutboxEvent", () => {
        expect((channelsApi as Record<string, unknown>).createChannelOutboxEvent).toBeUndefined()
    })

    it("exposes exactly the one write threads get: closeChannelThread", () => {
        expect(typeof channelsApi.closeChannelThread).toBe("function")
    })

    it("never re-derives an effective policy client-side — only resolveChannelPolicy talks to the API", () => {
        // The client never re-implements the intersection; it always calls
        // resolve_channel_policy. Pinned as: no local "resolvePolicy"/"intersect"
        // helper exists in the api module alongside the real network call.
        expect(typeof channelsApi.resolveChannelPolicy).toBe("function")
        expect((channelsApi as Record<string, unknown>).intersectPolicy).toBeUndefined()
        expect((channelsApi as Record<string, unknown>).resolvePolicyLocally).toBeUndefined()
    })
})
