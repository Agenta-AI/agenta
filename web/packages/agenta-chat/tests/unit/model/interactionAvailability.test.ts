import {describe, expect, it} from "vitest"

import {getInteractionAvailability} from "../../../src/model/interactionAvailability"

describe("interaction availability during Stop", () => {
    it("disables approval and parked interaction actions as soon as Stop starts", () => {
        expect(
            getInteractionAvailability({stopped: false, stopping: true, streaming: false}),
        ).toEqual({approvals: false, parkedDocks: false})
    })

    it("restores parked interaction actions after a failed Stop", () => {
        expect(
            getInteractionAvailability({stopped: false, stopping: false, streaming: false}),
        ).toEqual({approvals: true, parkedDocks: true})
    })

    it("keeps parked docks closed while a turn streams", () => {
        expect(
            getInteractionAvailability({stopped: false, stopping: false, streaming: true}),
        ).toEqual({approvals: true, parkedDocks: false})
    })
})
