import {describe, expect, it} from "vitest"

import {sessionListIdWindow} from "../../src/state/useSessionList"

const ids = (prefix: string) => Array.from({length: 100}, (_, index) => `${prefix}-${index}`)

describe("sessionListIdWindow", () => {
    it("sizes the pinned Sessions request for all 100 ids", () => {
        expect(sessionListIdWindow({status: "all", sessionIds: ids("pin")})).toMatchObject({
            limit: 100,
        })
    })

    it("sizes card and agent-activity id groups for all 100 waiting sessions", () => {
        expect(sessionListIdWindow({status: "all", sessionIds: ids("waiting")})).toMatchObject({
            limit: 100,
        })
    })

    it("sizes the Sessions waiting filter after intersecting its id sets", () => {
        const waiting = ids("waiting")
        expect(
            sessionListIdWindow({
                status: "waiting",
                sessionIds: [...waiting, "not-waiting"],
                waitingSessionIds: waiting,
            }),
        ).toEqual({sessionIds: waiting, limit: 100})
    })
})
