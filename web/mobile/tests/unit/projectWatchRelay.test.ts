import {afterEach, describe, expect, it} from "vitest"

import {
    PROJECT_WATCH_FALLBACK_MS,
    PROJECT_WATCH_LISTS,
    projectWatchUrl,
} from "../../src/features/app/projectWatchRelay"
import {sessionWatchUrl} from "../../src/features/chat/watchRelay"

const ENV_KEY = "NEXT_PUBLIC_AGENTA_API_URL"
const priorEnv = process.env[ENV_KEY]

afterEach(() => {
    if (priorEnv === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = priorEnv
})

describe("projectWatchUrl", () => {
    it("targets the project watch endpoint with the encoded project id", () => {
        process.env[ENV_KEY] = "http://localhost/api"
        expect(projectWatchUrl("proj-1")).toBe(
            "http://localhost/api/sessions/watch?project_id=proj-1",
        )
    })

    it("URL-encodes a hostile id instead of letting it extend the query", () => {
        process.env[ENV_KEY] = "http://localhost/api"
        expect(projectWatchUrl("a&b=c")).toBe(
            "http://localhost/api/sessions/watch?project_id=a%26b%3Dc",
        )
    })

    it("is a different endpoint from the per-session watch", () => {
        // The session relay watches one conversation; this one watches the whole project, which
        // is what carries "a session was created or finished somewhere else". Pointing the app
        // at the session endpoint would leave the lists exactly as stale as before.
        process.env[ENV_KEY] = "http://localhost/api"
        expect(projectWatchUrl("p")).not.toBe(sessionWatchUrl("s", "p"))
        expect(projectWatchUrl("p")).not.toContain("session_id")
    })
})

describe("PROJECT_WATCH_LISTS", () => {
    it("refreshes both lists on ready, because a reconnect has to cover the gap", () => {
        // `ready` fires on every (re)connect, including the one after the phone wakes up. Anything
        // it does not refresh stays as stale as it was before the stream died.
        expect(PROJECT_WATCH_LISTS.ready).toEqual(["sessions", "workflows"])
    })

    it("refreshes only the list each change event is about", () => {
        // Narrow on purpose: a busy chat emits session-changed steadily, and refetching the agents
        // list on every one of those would be pure waste.
        expect(PROJECT_WATCH_LISTS["session-changed"]).toEqual(["sessions"])
        expect(PROJECT_WATCH_LISTS["workflow-changed"]).toEqual(["workflows"])
    })

    it("handles every event the desktop watcher handles", () => {
        // The desktop maps exactly these three. A missing one here is a list that goes stale on
        // /m and nowhere else, which is the bug this whole hook exists to fix.
        expect(Object.keys(PROJECT_WATCH_LISTS).sort()).toEqual([
            "ready",
            "session-changed",
            "workflow-changed",
        ])
    })
})

describe("PROJECT_WATCH_FALLBACK_MS", () => {
    it("polls every 30 seconds while the combined stream is unavailable", () => {
        expect(PROJECT_WATCH_FALLBACK_MS).toBe(30_000)
    })
})
