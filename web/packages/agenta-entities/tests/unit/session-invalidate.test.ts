import {QueryClient} from "@tanstack/react-query"
import {describe, expect, it, vi} from "vitest"

const client = new QueryClient()
vi.mock("@agenta/shared/api", () => ({
    getHostQueryClient: () => client,
}))

import {invalidateSessionListQueries} from "../../src/session/state/invalidate"

const seed = (queryKey: unknown[]) => client.setQueryData(queryKey, {})
const isInvalid = (queryKey: unknown[]) => client.getQueryState(queryKey)?.isInvalidated ?? false

describe("invalidateSessionListQueries", () => {
    it("reaches every list nesting and the per-session record, never their siblings", () => {
        seed(["session-list", "p1"])
        seed(["sidebar", "session-list", "p1"])
        seed(["mobile", "head", "session-list", "p1"])
        // `/m` feeds the browser title from this one; the agent names a session after its first
        // turn, so a title read once at open never caught up without it.
        seed(["session-stream", "p1", "s1"])
        seed(["mobile", "session-liveness", "p1"])
        seed(["sidebar-sessions-pinned"])

        invalidateSessionListQueries()

        expect(isInvalid(["session-list", "p1"])).toBe(true)
        expect(isInvalid(["sidebar", "session-list", "p1"])).toBe(true)
        expect(isInvalid(["mobile", "head", "session-list", "p1"])).toBe(true)
        expect(isInvalid(["session-stream", "p1", "s1"])).toBe(true)
        expect(isInvalid(["mobile", "session-liveness", "p1"])).toBe(false)
        expect(isInvalid(["sidebar-sessions-pinned"])).toBe(false)
    })
})
