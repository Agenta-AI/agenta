import {describe, expect, it} from "vitest"

import {
    openWindow,
    settleWindow,
    wantsOlderTurns,
    widenWindow,
} from "@/features/chat/transcriptWindow"

const BAND = 80

describe("transcript window", () => {
    it("renders a session of 12 or fewer turns whole", () => {
        expect(openWindow(0)).toEqual({start: 0, total: 0})
        expect(openWindow(12)).toEqual({start: 0, total: 12})
    })

    it("opens a longer session on its last 12 turns", () => {
        expect(openWindow(40)).toEqual({start: 28, total: 40})
    })

    it("widens by 12 and stops at the first turn", () => {
        expect(widenWindow({start: 28, total: 40})).toEqual({start: 16, total: 40})
        expect(widenWindow({start: 5, total: 40})).toEqual({start: 0, total: 40})
    })

    it("keeps the first rendered turn when turns stream in", () => {
        expect(settleWindow({start: 28, total: 40}, 41)).toEqual({start: 28, total: 41})
    })

    it("returns the held window while the count stands", () => {
        const held = {start: 28, total: 40}
        expect(settleWindow(held, 40)).toBe(held)
    })

    it("opens at the tail again when a load lands more than a window of turns", () => {
        expect(settleWindow({start: 0, total: 3}, 40)).toEqual({start: 28, total: 40})
    })

    it("keeps a full tail when turns are removed", () => {
        expect(settleWindow({start: 28, total: 40}, 20)).toEqual({start: 8, total: 20})
        expect(settleWindow({start: 2, total: 40}, 20)).toEqual({start: 2, total: 20})
    })
})

describe("wantsOlderTurns", () => {
    const tall = {scrollHeight: 5000, clientHeight: 700}

    it("asks for a reader moving up near the top", () => {
        expect(wantsOlderTurns({...tall, scrollTop: 300}, true, BAND)).toBe(true)
    })

    it("ignores a downward move near the top, such as the opening pin", () => {
        expect(wantsOlderTurns({...tall, scrollTop: 300}, false, BAND)).toBe(false)
    })

    it("ignores a reader far from the top", () => {
        expect(wantsOlderTurns({...tall, scrollTop: 2000}, true, BAND)).toBe(false)
    })

    it("waits while the reader is still inside the follow band", () => {
        const short = {scrollHeight: 1200, clientHeight: 700}
        expect(wantsOlderTurns({...short, scrollTop: 450}, true, BAND)).toBe(false)
        expect(wantsOlderTurns({...short, scrollTop: 400}, true, BAND)).toBe(true)
    })

    it("asks when the content is too short to leave the follow band", () => {
        expect(
            wantsOlderTurns({scrollTop: 0, scrollHeight: 700, clientHeight: 700}, false, BAND),
        ).toBe(true)
    })

    it("ignores a hidden pane", () => {
        expect(wantsOlderTurns({scrollTop: 0, scrollHeight: 0, clientHeight: 0}, true, BAND)).toBe(
            false,
        )
    })
})
