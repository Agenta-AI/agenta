/**
 * Pins the transcript-adoption rule (`core/transcriptAdoption.ts`) — the whole of issue #5530,
 * where a browser that snapshotted a session mid-turn stayed stuck on the partial copy forever
 * because the guard compared MESSAGE counts and a turn grows in place.
 *
 * The rule has one trigger (the record log grew past our watermark) and two vetoes (a live local
 * stream; a server snapshot shorter than what we render). These lock all three.
 */
import {describe, expect, it} from "vitest"

import {
    shouldAdoptServerTranscript,
    type TranscriptAdoptionInput,
} from "../../src/session/core/transcriptAdoption"

/** A finished server turn (40 records) against a snapshot taken mid-turn (12 records). */
const input = (overrides: Partial<TranscriptAdoptionInput> = {}): TranscriptAdoptionInput => ({
    serverRecordCount: 40,
    serverMessageCount: 2,
    localMessageCount: 2,
    watermark: 12,
    busy: false,
    ...overrides,
})

describe("shouldAdoptServerTranscript", () => {
    it("adopts a turn that grew IN PLACE — the issue #5530 case", () => {
        // Identical message counts, far more records. A count-based guard rejects this forever.
        expect(shouldAdoptServerTranscript(input())).toBe(true)
    })

    it("rejects when the log has not grown past the rendered transcript", () => {
        expect(shouldAdoptServerTranscript(input({serverRecordCount: 12}))).toBe(false)
        expect(shouldAdoptServerTranscript(input({serverRecordCount: 11}))).toBe(false)
    })

    it("re-syncs a transcript with no watermark, then stops repeating", () => {
        // A locally-streamed turn, or a cache written before the watermark existed.
        expect(shouldAdoptServerTranscript(input({watermark: undefined}))).toBe(true)
        // Once adopted, the watermark equals the log and the next pass is a no-op.
        expect(shouldAdoptServerTranscript(input({watermark: 40, serverRecordCount: 40}))).toBe(
            false,
        )
    })

    it("never trades a longer local transcript for a lagging server snapshot", () => {
        // Ingest lag: ahead in records, not yet caught up in messages.
        expect(
            shouldAdoptServerTranscript(
                input({serverMessageCount: 2, localMessageCount: 3, watermark: undefined}),
            ),
        ).toBe(false)
    })

    it("never clobbers a live local stream", () => {
        expect(shouldAdoptServerTranscript(input({busy: true}))).toBe(false)
        // Even a far-ahead server copy waits for the stream to settle.
        expect(shouldAdoptServerTranscript(input({busy: true, serverRecordCount: 9999}))).toBe(
            false,
        )
    })

    it("ignores an empty server transcript", () => {
        expect(shouldAdoptServerTranscript(input({serverMessageCount: 0}))).toBe(false)
    })
})
