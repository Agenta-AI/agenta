import {afterEach, describe, expect, it} from "vitest"

import {projectWatchUrl} from "../../src/features/app/projectWatchRelay"
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
