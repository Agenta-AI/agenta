import type {SessionTranscript} from "@agenta/chat/assets"
import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {shouldAdoptTranscript} from "../../src/features/chat/transcriptAdoption"

const transcript = (
    messageCount: number,
    recordCount: number,
    sequenceCursor?: number,
): SessionTranscript => ({
    messages: Array.from(
        {length: messageCount},
        (_, i) => ({id: `m${i}`, role: "assistant", parts: []}) as UIMessage,
    ),
    recordCount,
    sequenceCursor,
})

const rendered = (messageCount: number, recordCount?: number, sequenceCursor?: number) => ({
    messageCount,
    recordCount,
    sequenceCursor,
})

describe("shouldAdoptTranscript", () => {
    it("adopts the first delivery for a freshly opened session", () => {
        expect(shouldAdoptTranscript(transcript(3, 12), rendered(0))).toBe(true)
    })

    it("ignores a failed / history-less load", () => {
        expect(shouldAdoptTranscript(null, rendered(0))).toBe(false)
        expect(shouldAdoptTranscript(transcript(0, 0), rendered(0))).toBe(false)
    })

    it("ignores a re-read that brought no new records", () => {
        expect(shouldAdoptTranscript(transcript(3, 12), rendered(3, 12))).toBe(false)
    })

    // Issue #5530: a turn that grows in place (tool results landing, an approval round-trip
    // completing) keeps its message count, so only the record watermark sees the growth.
    it("adopts a grown log even when the message count is unchanged", () => {
        expect(shouldAdoptTranscript(transcript(3, 40), rendered(3, 12))).toBe(true)
    })

    it("never trades down to a snapshot shorter than what is on screen", () => {
        expect(shouldAdoptTranscript(transcript(2, 40), rendered(3, 12))).toBe(false)
    })

    // Mobile keeps no persisted transcript, so a session it has rendered before still opens with
    // an absent watermark — which reads as 0 and re-syncs from the durable log once.
    it("re-syncs when the watermark is absent", () => {
        expect(shouldAdoptTranscript(transcript(3, 12), rendered(3))).toBe(true)
    })

    it("adopts sequence growth when retention keeps the row count flat", () => {
        expect(shouldAdoptTranscript(transcript(3, 20, 101), rendered(3, 20, 100))).toBe(true)
    })
})
