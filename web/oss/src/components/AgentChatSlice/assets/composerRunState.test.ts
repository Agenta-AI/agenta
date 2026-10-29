import {isComposerRunStoppable} from "@agenta/chat/assets"
import {describe, expect, it} from "vitest"

describe("desktop composer run state", () => {
    it("keeps this browser's own stream stoppable", () => {
        expect(
            isComposerRunStoppable({
                localStreaming: true,
                serverBusy: false,
                waitingOnUser: false,
            }),
        ).toBe(true)
    })

    it("exposes Stop for a run the server owns", () => {
        expect(
            isComposerRunStoppable({
                localStreaming: false,
                serverBusy: true,
                waitingOnUser: false,
            }),
        ).toBe(true)
    })
})
