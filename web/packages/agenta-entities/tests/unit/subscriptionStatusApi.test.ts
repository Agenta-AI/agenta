/**
 * The `POST /runtime/subscription-status` boundary: the request the browser sends to the agent
 * service, and the zod check that keeps an unreadable answer from reaching the card as if it were
 * a real status.
 */
import {beforeEach, describe, expect, it, vi} from "vitest"

// Hoisted: the factory reads `post` eagerly, so it cannot be a plain top-level const.
const {post} = vi.hoisted(() => ({post: vi.fn()}))

vi.mock("@agenta/shared/api", () => ({
    axios: {post},
    getAgentaApiUrl: () => "https://cloud.agenta.ai/api",
}))

import {fetchSubscriptionStatus} from "../../src/workflow/api/subscriptionStatus"

const VALID = {
    runner: "connected",
    checked_at: "2026-08-12T12:00:00Z",
    harnesses: {codex: {state: "ready", provider: "openai"}},
}

beforeEach(() => {
    post.mockReset()
})

describe("fetchSubscriptionStatus", () => {
    it("posts the harness to the agent service with the project scope", async () => {
        post.mockResolvedValueOnce({data: VALID})

        const result = await fetchSubscriptionStatus({harness: "codex", projectId: "proj-1"})

        expect(post).toHaveBeenCalledTimes(1)
        const [url, body, config] = post.mock.calls[0]
        expect(url).toBe("https://cloud.agenta.ai/services/agent/v0/runtime/subscription-status")
        expect(body).toEqual({harness: "codex"})
        expect(config).toEqual({params: {project_id: "proj-1"}})
        expect(result).toEqual(VALID)
    })

    it("sends no runner URL — the server resolves the runner itself", async () => {
        post.mockResolvedValueOnce({data: VALID})

        await fetchSubscriptionStatus({harness: "codex", projectId: "proj-1"})

        expect(Object.keys(post.mock.calls[0][1])).toEqual(["harness"])
    })

    it("accepts a response with no harness map and no provider", async () => {
        post.mockResolvedValueOnce({data: {runner: "unavailable", checked_at: null}})

        const result = await fetchSubscriptionStatus({harness: "codex", projectId: "proj-1"})

        expect(result).toEqual({runner: "unavailable", checked_at: null})
    })

    it("keeps a harness state this build does not know (the mapper owns that vocabulary)", async () => {
        post.mockResolvedValueOnce({
            data: {runner: "connected", harnesses: {codex: {state: "gone_fishing"}}},
        })

        const result = await fetchSubscriptionStatus({harness: "codex", projectId: "proj-1"})

        expect(result?.harnesses?.codex.state).toBe("gone_fishing")
    })

    it("falls back to null on a payload that fails the schema", async () => {
        for (const data of [
            {runner: "banana"},
            {checked_at: "2026-08-12T12:00:00Z"},
            {runner: "connected", harnesses: {codex: "ready"}},
            "<!doctype html>",
            null,
        ]) {
            post.mockResolvedValueOnce({data})
            expect(
                await fetchSubscriptionStatus({harness: "codex", projectId: "proj-1"}),
            ).toBeNull()
        }
    })

    it("makes no request without a harness or a project", async () => {
        expect(await fetchSubscriptionStatus({harness: "", projectId: "proj-1"})).toBeNull()
        expect(await fetchSubscriptionStatus({harness: "codex", projectId: ""})).toBeNull()
        expect(post).not.toHaveBeenCalled()
    })
})
