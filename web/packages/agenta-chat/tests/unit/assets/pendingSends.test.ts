import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {
    compactPendingSendCoverage,
    countUserMessages,
    durableUserTurnIds,
    mergePendingSendRows,
    nextPendingSendCoverage,
    pendingSendMessages,
    retirePendingSends,
    type PendingSend,
} from "../../../src/assets/pendingSends"

const user = (id: string, text: string, turnId?: string): UIMessage =>
    ({
        id,
        role: "user",
        parts: [{type: "text", text}],
        ...(turnId ? {metadata: {turnId}} : {}),
    }) as UIMessage

const assistant = (id: string, text: string): UIMessage =>
    ({id, role: "assistant", parts: [{type: "text", text}]}) as UIMessage

const preview = (executionId: string): UIMessage =>
    ({
        id: `live-preview-${executionId}`,
        role: "assistant",
        parts: [{type: "text", text: "…"}],
        metadata: {livePreview: true, executionId},
    }) as unknown as UIMessage

const echo = (
    id: string,
    text: string,
    coveredAtUserCount: number,
    extra: Partial<PendingSend> = {},
): PendingSend => ({
    id,
    text,
    coveredAtUserCount,
    createdAtUserCount: coveredAtUserCount - 1,
    ...extra,
})

const retire = (
    pending: readonly PendingSend[],
    userCount: number,
    turnIds: string[] = [],
    dockedIds: string[] = [],
) =>
    retirePendingSends(pending, {
        userCount,
        durableTurnIds: new Set(turnIds),
        dockedIds: new Set(dockedIds),
    })

describe("countUserMessages", () => {
    it("counts only the user rows", () => {
        expect(countUserMessages([user("u1", "a"), assistant("a1", "b"), user("u2", "c")])).toBe(2)
    })
})

describe("durableUserTurnIds", () => {
    it("collects turn ids from user rows only", () => {
        const messages = [
            user("u1", "a", "turn-a"),
            assistant("a1", "b"),
            user("u2", "c"),
            user("u3", "d", "turn-d"),
        ]
        expect([...durableUserTurnIds(messages)].sort()).toEqual(["turn-a", "turn-d"])
    })
})

describe("nextPendingSendCoverage", () => {
    it("queues behind echoes already waiting, so a burst retires in FIFO order", () => {
        const first = echo("m1", "one", nextPendingSendCoverage(2, []))
        const second = echo("m2", "two", nextPendingSendCoverage(2, [first]))
        expect([first, second].map((item) => item.coveredAtUserCount)).toEqual([3, 4])
    })
})

describe("retirePendingSends by count, before the turn id is known", () => {
    it("keeps an echo the transcript has not caught up with", () => {
        const pending = [echo("m1", "one", 3)]
        expect(retire(pending, 2)).toEqual(pending)
    })

    it("drops an echo once the count reaches it", () => {
        expect(retire([echo("m1", "one", 3)], 3)).toEqual([])
    })

    it("returns the same array when nothing retires, so the render memo does not churn", () => {
        const pending = [echo("m1", "one", 3)]
        expect(retire(pending, 2)).toBe(pending)
    })

    it("drops an echo a rewind stranded below its own origin", () => {
        expect(retire([echo("m1", "one", 5, {createdAtUserCount: 4})], 2)).toEqual([])
    })
})

describe("retirePendingSends by turn id, once the send is acknowledged", () => {
    it("ignores a foreign user row and waits for its own saved row", () => {
        // Another tab's message, a promoted queued input, or a history adoption all raise the
        // count while saying nothing about THIS send.
        const pending = [echo("m1", "mine", 1, {executionId: "turn-mine"})]
        expect(retire(pending, 1, ["turn-foreign"])).toEqual(pending)
        expect(retire(pending, 9, ["turn-foreign", "turn-other"])).toEqual(pending)
    })

    it("retires exactly when its own saved row is adopted", () => {
        const pending = [echo("m1", "mine", 1, {executionId: "turn-mine"})]
        expect(retire(pending, 1, ["turn-foreign", "turn-mine"])).toEqual([])
    })

    it("still drops an acknowledged echo a rewind stranded", () => {
        const pending = [echo("m1", "mine", 5, {createdAtUserCount: 4, executionId: "turn-mine"})]
        expect(retire(pending, 2, [])).toEqual([])
    })
})

describe("retirePendingSends and the dock", () => {
    it("drops an echo the durable queue now holds", () => {
        const pending = [echo("m1", "queued", 3)]
        expect(retire(pending, 1, [], ["m1"])).toEqual([])
    })
})

describe("compactPendingSendCoverage", () => {
    it("renumbers the echo left behind a dropped one", () => {
        // A reserved 4 and B reserved 5 over three saved rows. A fails, so B's record saves as row
        // four. Without renumbering B waits for five forever and duplicates its own saved row.
        const remaining = compactPendingSendCoverage([echo("mB", "two", 5)], 3)
        expect(remaining[0].coveredAtUserCount).toBe(4)
    })

    it("keeps a run that already matches the transcript untouched", () => {
        const pending = [echo("m1", "one", 4), echo("m2", "two", 5)]
        expect(compactPendingSendCoverage(pending, 3)).toBe(pending)
    })

    it("closes a gap left in the middle of a burst", () => {
        const pending = [echo("m1", "one", 4), echo("m3", "three", 6)]
        expect(compactPendingSendCoverage(pending, 3).map((i) => i.coveredAtUserCount)).toEqual([
            4, 5,
        ])
    })
})

describe("pendingSendMessages", () => {
    it("renders one user row per echo, prefixed so it is never mistaken for a saved row", () => {
        const rows = pendingSendMessages([echo("m1", "hello", 3)])
        expect(rows[0].id).toBe("pending-send-m1")
        expect(rows[0].role).toBe("user")
        expect(rows[0].parts).toEqual([{type: "text", text: "hello"}])
        expect(rows[0].metadata).toEqual({pendingSend: true})
    })

    it("carries the acknowledged turn id and a failure marker", () => {
        const rows = pendingSendMessages([
            echo("m1", "hi", 3, {executionId: "turn-1", failed: true}),
        ])
        expect(rows[0].metadata).toEqual({
            pendingSend: true,
            pendingSendExecutionId: "turn-1",
            pendingSendFailed: true,
        })
    })

    it("carries attachments and drops an empty text part", () => {
        const file = {
            type: "file" as const,
            url: "https://example.test/a.png",
            mediaType: "image/png",
        }
        const rows = pendingSendMessages([echo("m2", "", 1, {fileParts: [file]})])
        expect(rows[0].parts).toEqual([file])
    })
})

describe("mergePendingSendRows", () => {
    const durable = [user("u1", "saved")]

    it("returns the durable list untouched when there is nothing to add", () => {
        expect(mergePendingSendRows(durable, [], [])).toBe(durable)
    })

    it("puts an echo above the preview of its own turn", () => {
        const echoes = pendingSendMessages([echo("m1", "asked", 2, {executionId: "turn-1"})])
        const merged = mergePendingSendRows(durable, echoes, [preview("turn-1")])
        expect(merged.map((m) => m.id)).toEqual(["u1", "pending-send-m1", "live-preview-turn-1"])
    })

    it("keeps an earlier turn's preview above the echo", () => {
        // That preview is the previous answer, still on screen; the new question belongs below it.
        const echoes = pendingSendMessages([echo("m1", "asked", 2, {executionId: "turn-2"})])
        const merged = mergePendingSendRows(durable, echoes, [preview("turn-1")])
        expect(merged.map((m) => m.id)).toEqual(["u1", "live-preview-turn-1", "pending-send-m1"])
    })

    it("splits previews around the echo when both are present", () => {
        const echoes = pendingSendMessages([echo("m1", "asked", 2, {executionId: "turn-2"})])
        const merged = mergePendingSendRows(durable, echoes, [preview("turn-1"), preview("turn-2")])
        expect(merged.map((m) => m.id)).toEqual([
            "u1",
            "live-preview-turn-1",
            "pending-send-m1",
            "live-preview-turn-2",
        ])
    })
})
