import {afterEach, describe, expect, it} from "vitest"

import {sessionWatchUrl, watchAwarePollMs} from "../../src/features/chat/watchRelay"

const ENV_KEY = "NEXT_PUBLIC_AGENTA_API_URL"
const priorEnv = process.env[ENV_KEY]

afterEach(() => {
    if (priorEnv === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = priorEnv
})

describe("sessionWatchUrl", () => {
    it("targets the watch endpoint with encoded session and project ids", () => {
        process.env[ENV_KEY] = "http://localhost/api"
        expect(sessionWatchUrl("sess-1", "proj-1")).toBe(
            "http://localhost/api/sessions/streams/watch?session_id=sess-1&project_id=proj-1",
        )
    })

    it("URL-encodes hostile ids instead of letting them extend the query", () => {
        process.env[ENV_KEY] = "http://localhost/api"
        expect(sessionWatchUrl("a&b=c", "p")).toBe(
            "http://localhost/api/sessions/streams/watch?session_id=a%26b%3Dc&project_id=p",
        )
    })
})

describe("watchAwarePollMs", () => {
    it("stretches an active cadence to the 30s safety net while the stream is open", () => {
        expect(watchAwarePollMs(7_500, true)).toBe(30_000)
        expect(watchAwarePollMs(4_000, true)).toBe(30_000)
    })

    it("keeps today's cadence untouched when the stream is down (no-regression fallback)", () => {
        expect(watchAwarePollMs(7_500, false)).toBe(7_500)
        expect(watchAwarePollMs(4_000, false)).toBe(4_000)
        expect(watchAwarePollMs(0, false)).toBe(0)
    })

    it("never wakes an idle screen just because the stream is open", () => {
        expect(watchAwarePollMs(0, true)).toBe(0)
    })
})
