import type {SessionStream} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {sessionOpenTarget} from "../../src/row/sessionOpenTarget"

const APP_ID = "11111111-1111-4111-8111-111111111111"

const row = (overrides: Partial<SessionStream> = {}): SessionStream =>
    ({
        project_id: "22222222-2222-4222-8222-222222222222",
        session_id: "sess-1",
        ...overrides,
    }) as SessionStream

describe("sessionOpenTarget", () => {
    it("resolves the agent from the latest turn's references", () => {
        expect(
            sessionOpenTarget(row({references: [{id: APP_ID}], name: "Positioning doc"})),
        ).toEqual({appId: APP_ID, sessionId: "sess-1", title: "Positioning doc"})
    })

    it("returns null for a session with no turns yet", () => {
        expect(sessionOpenTarget(row())).toBeNull()
        expect(sessionOpenTarget(row({references: []}))).toBeNull()
    })

    it("skips references whose id is not a real app id", () => {
        expect(sessionOpenTarget(row({references: [{slug: "some-agent"}]}))).toBeNull()
        expect(sessionOpenTarget(row({references: [{id: "not-a-uuid"}]}))).toBeNull()
    })

    it("takes the first usable reference when several are stamped", () => {
        const target = sessionOpenTarget(row({references: [{id: "not-a-uuid"}, {id: APP_ID}]}))
        expect(target?.appId).toBe(APP_ID)
    })

    it("omits a blank title so the label falls back to the derived one", () => {
        expect(
            sessionOpenTarget(row({references: [{id: APP_ID}], name: "   "}))?.title,
        ).toBeUndefined()
    })
})
