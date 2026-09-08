import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {
    countUserMessages,
    nextPendingSendCoverage,
    pendingSendMessages,
    retirePendingSends,
    type PendingSend,
} from "../../../src/assets/pendingSends"

const user = (id: string, text: string): UIMessage =>
    ({id, role: "user", parts: [{type: "text", text}]}) as UIMessage

const assistant = (id: string, text: string): UIMessage =>
    ({id, role: "assistant", parts: [{type: "text", text}]}) as UIMessage

const echo = (
    id: string,
    text: string,
    coveredAtUserCount: number,
    createdAtUserCount = coveredAtUserCount - 1,
): PendingSend => ({
    id,
    text,
    coveredAtUserCount,
    createdAtUserCount,
})

describe("countUserMessages", () => {
    it("counts only the user rows", () => {
        expect(countUserMessages([user("u1", "a"), assistant("a1", "b"), user("u2", "c")])).toBe(2)
    })

    it("is zero for an empty transcript", () => {
        expect(countUserMessages([])).toBe(0)
    })
})

describe("nextPendingSendCoverage", () => {
    it("waits for one more user row than the transcript already holds", () => {
        expect(nextPendingSendCoverage(3, [])).toBe(4)
    })

    it("queues behind echoes already waiting, so a burst retires in FIFO order", () => {
        const first = echo("m1", "one", nextPendingSendCoverage(2, []))
        const second = echo("m2", "two", nextPendingSendCoverage(2, [first]))
        const third = echo("m3", "three", nextPendingSendCoverage(2, [first, second]))
        expect([first, second, third].map((item) => item.coveredAtUserCount)).toEqual([3, 4, 5])
    })
})

describe("retirePendingSends", () => {
    it("keeps an echo the transcript has not caught up with", () => {
        const pending = [echo("m1", "one", 3)]
        expect(retirePendingSends(pending, 2)).toEqual(pending)
    })

    it("drops an echo once its durable row is counted", () => {
        expect(retirePendingSends([echo("m1", "one", 3)], 3)).toEqual([])
    })

    it("retires a burst one row at a time, oldest first", () => {
        const pending = [echo("m1", "one", 3), echo("m2", "two", 4)]
        expect(retirePendingSends(pending, 3).map((item) => item.id)).toEqual(["m2"])
        expect(retirePendingSends(pending, 4)).toEqual([])
    })

    it("returns the same array when nothing retires, so the render memo does not churn", () => {
        const pending = [echo("m1", "one", 3)]
        expect(retirePendingSends(pending, 2)).toBe(pending)
    })

    it("keeps an echo while the transcript is still at or above its origin", () => {
        const pending = [echo("m1", "one", 5, 4)]
        expect(retirePendingSends(pending, 4)).toEqual(pending)
    })

    it("drops an echo a rewind stranded below its own origin", () => {
        // Rewinding past the point the send belongs to means its row can never be counted, so the
        // echo would otherwise sit on screen until an unrelated send happened to raise the count.
        const pending = [echo("m1", "one", 5, 4)]
        expect(retirePendingSends(pending, 2)).toEqual([])
    })

    it("drops a whole burst a rewind stranded, not only its head", () => {
        const pending = [echo("m1", "one", 5, 4), echo("m2", "two", 6, 4)]
        expect(retirePendingSends(pending, 1)).toEqual([])
    })
})

describe("pendingSendMessages", () => {
    it("renders one user row per echo, prefixed so it is never mistaken for a saved row", () => {
        const rows = pendingSendMessages([echo("m1", "hello", 3)])
        expect(rows).toHaveLength(1)
        expect(rows[0].id).toBe("pending-send-m1")
        expect(rows[0].role).toBe("user")
        expect(rows[0].parts).toEqual([{type: "text", text: "hello"}])
        expect(rows[0].metadata).toEqual({pendingSend: true})
    })

    it("carries attachments and drops an empty text part", () => {
        const file = {
            type: "file" as const,
            url: "https://example.test/a.png",
            mediaType: "image/png",
        }
        const rows = pendingSendMessages([
            {id: "m2", text: "", fileParts: [file], coveredAtUserCount: 1, createdAtUserCount: 0},
        ])
        expect(rows[0].parts).toEqual([file])
    })
})
