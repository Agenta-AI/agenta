import {isComposerRunStoppable} from "@agenta/chat/assets"
import {describe, expect, it} from "vitest"

describe("desktop composer run state", () => {
    it("does not expose Stop for another browser's run when capabilities are absent", () => {
        expect(
            isComposerRunStoppable({
                localStreaming: false,
                serverBusy: true,
                serverControlEnabled: false,
                waitingOnUser: false,
            }),
        ).toBe(false)
    })

    it("keeps this browser's legacy stream stoppable when capabilities are absent", () => {
        expect(
            isComposerRunStoppable({
                localStreaming: true,
                serverBusy: false,
                serverControlEnabled: false,
                waitingOnUser: false,
            }),
        ).toBe(true)
    })
})
