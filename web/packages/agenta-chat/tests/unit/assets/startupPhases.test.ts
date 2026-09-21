import {describe, expect, it} from "vitest"

import {startupLabelFromDataPart} from "../../../src/assets/startupPhases"

describe("observed startup labels", () => {
    it("maps the runner's observed environment boundaries", () => {
        expect(
            startupLabelFromDataPart({
                type: "data-agent-status",
                data: {phase: "environment_starting"},
            }),
        ).toBe("Getting things ready")
        expect(
            startupLabelFromDataPart({
                type: "data-agent-status",
                data: {phase: "environment_ready"},
            }),
        ).toBe("Ready")
    })

    it("names the two stages inside the acquire, so a cold start is not one static line", () => {
        // Without its own phase the whole 19.2s create_session sat under "Getting things ready".
        expect(
            startupLabelFromDataPart({
                type: "data-agent-status",
                data: {phase: "preparing_workspace"},
            }),
        ).toBe("Loading details")
        expect(
            startupLabelFromDataPart({
                type: "data-agent-status",
                data: {phase: "opening_session"},
            }),
        ).toBe("Almost there")
    })

    it("ignores unrelated and unknown data", () => {
        expect(
            startupLabelFromDataPart({type: "data-other", data: {phase: "environment_ready"}}),
        ).toBeNull()
        expect(
            startupLabelFromDataPart({
                type: "data-agent-status",
                data: {phase: "future_phase"},
            }),
        ).toBeNull()
        expect(startupLabelFromDataPart(null)).toBeNull()
    })

    it("rejects keys inherited from Object.prototype", () => {
        for (const phase of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
            expect(startupLabelFromDataPart({type: "data-agent-status", data: {phase}})).toBeNull()
        }
    })
})
