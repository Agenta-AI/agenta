import {describe, expect, it} from "vitest"

import {sessionScopeFromRouteQuery} from "./sessionRouteScope"

describe("sessionScopeFromRouteQuery", () => {
    it("maps mode=automation to the automation session scope", () => {
        expect(sessionScopeFromRouteQuery({mode: "automation"})).toEqual({origin: "trigger"})
    })

    it("ignores a missing or unknown mode", () => {
        expect(sessionScopeFromRouteQuery({})).toBeUndefined()
        expect(sessionScopeFromRouteQuery({mode: "unknown"})).toBeUndefined()
    })

    it("leaves existing session filters alone for the original sessions URL", () => {
        expect(sessionScopeFromRouteQuery({view: "sessions"})).toBeUndefined()
    })

    it("ignores an array-valued mode query", () => {
        expect(sessionScopeFromRouteQuery({mode: ["automation"]})).toBeUndefined()
    })
})
