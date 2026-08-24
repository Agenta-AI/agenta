import {describe, expect, it} from "vitest"

import {beginTurn, finishTurn, initialTurnLock} from "@/lib/state/sessions"

describe("turn submission lock", () => {
    it("holds the first client turn id until that turn resolves", () => {
        const active = beginTurn(initialTurnLock, "first")
        expect(beginTurn(active, "duplicate")).toBe(active)
        expect(finishTurn(active, "duplicate")).toBe(active)
        expect(finishTurn(active, "first")).toEqual(initialTurnLock)
    })

    it("allows retry to use a new client turn id", () => {
        const first = finishTurn(beginTurn(initialTurnLock, "first"), "first")
        expect(beginTurn(first, "retry").activeClientTurnId).toBe("retry")
    })
})
