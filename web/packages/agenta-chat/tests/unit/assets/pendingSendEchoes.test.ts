import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {
    compactPendingSendCoverage,
    countUserMessages,
    durableUserTurnIds,
    isPendingSendFailed,
    mergePendingSendEchoRows,
    PENDING_SEND_FAILED_NOTE,
    nextPendingSendCoverage,
    pendingSendEchoMessages,
    retirePendingSendEchoes,
    type PendingSendEcho,
} from "../../../src/assets/pendingSendEchoes"

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
    extra: Partial<PendingSendEcho> = {},
): PendingSendEcho => ({
    id,
    text,
    coveredAtUserCount,
    createdAtUserCount: coveredAtUserCount - 1,
    ...extra,
})

const retire = (
    pending: readonly PendingSendEcho[],
    userCount: number,
    turnIds: string[] = [],
    dockedIds: string[] = [],
) =>
    retirePendingSendEchoes(pending, {
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

describe("retirePendingSendEchoes by count, before the turn id is known", () => {
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

describe("retirePendingSendEchoes by turn id, once the send is acknowledged", () => {
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

describe("retirePendingSendEchoes and the dock", () => {
    it("keeps a parked echo until the dock is OBSERVED to hold its input", () => {
        // A completed snapshot request is not evidence the dock has the row.
        const pending = [echo("m1", "queued", 3, {parkedInputId: "input-1"})]
        expect(retire(pending, 2, [], [])).toEqual(pending)
        expect(retire(pending, 2, [], ["input-1"])).toEqual([])
    })

    it("still bounds a parked echo the dock never shows, when promotion beat observation", () => {
        // A promoted input leaves the dock query for good and never gets a turn id of its own,
        // so dock membership alone would leave this echo on screen forever.
        const pending = [echo("m1", "queued", 3, {parkedInputId: "input-1"})]
        expect(retire(pending, 3, [], [])).toEqual([])
    })

    it("ignores a dock row belonging to some other input", () => {
        const pending = [echo("m1", "queued", 3, {parkedInputId: "input-1"})]
        expect(retire(pending, 2, [], ["input-2"])).toEqual(pending)
    })

    it("KEEPS an echo marked failed, so the text is not silently lost", () => {
        // The composer has already cleared by then. Dropping the row would delete what the user
        // wrote and show nothing in its place, which is worse than the gap this PR fixes.
        const pending = [echo("m1", "refused", 3, {failed: true})]
        expect(retire(pending, 2)).toEqual(pending)
        expect(retire(pending, 99, ["any-turn"], ["any-input"])).toEqual(pending)
    })

    it("flags a failed row so a host can render it as failed", () => {
        const rows = pendingSendEchoMessages([echo("m1", "refused", 3, {failed: true})])
        expect(rows[0].metadata).toEqual({pendingSend: true, pendingSendFailed: true})
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

describe("pendingSendEchoMessages", () => {
    it("renders one user row per echo, prefixed so it is never mistaken for a saved row", () => {
        const rows = pendingSendEchoMessages([echo("m1", "hello", 3)])
        expect(rows[0].id).toBe("pending-send-m1")
        expect(rows[0].role).toBe("user")
        expect(rows[0].parts).toEqual([{type: "text", text: "hello"}])
        expect(rows[0].metadata).toEqual({pendingSend: true})
    })

    it("carries the acknowledged turn id, which is what orders it against a preview", () => {
        const rows = pendingSendEchoMessages([echo("m1", "hi", 3, {executionId: "turn-1"})])
        expect(rows[0].metadata).toEqual({pendingSend: true, pendingSendExecutionId: "turn-1"})
    })

    it("carries attachments and drops an empty text part", () => {
        const file = {
            type: "file" as const,
            url: "https://example.test/a.png",
            mediaType: "image/png",
        }
        const rows = pendingSendEchoMessages([echo("m2", "", 1, {fileParts: [file]})])
        expect(rows[0].parts).toEqual([file])
    })
})

describe("mergePendingSendEchoRows", () => {
    const durable = [user("u1", "saved")]

    it("returns the durable list untouched when there is nothing to add", () => {
        expect(mergePendingSendEchoRows(durable, [], [])).toBe(durable)
    })

    it("puts an echo above the preview of its own turn", () => {
        const echoes = pendingSendEchoMessages([echo("m1", "asked", 2, {executionId: "turn-1"})])
        const merged = mergePendingSendEchoRows(durable, echoes, [preview("turn-1")])
        expect(merged.map((m) => m.id)).toEqual(["u1", "pending-send-m1", "live-preview-turn-1"])
    })

    it("keeps an earlier turn's preview above the echo", () => {
        // That preview is the previous answer, still on screen; the new question belongs below it.
        const echoes = pendingSendEchoMessages([echo("m1", "asked", 2, {executionId: "turn-2"})])
        const merged = mergePendingSendEchoRows(durable, echoes, [preview("turn-1")])
        expect(merged.map((m) => m.id)).toEqual(["u1", "live-preview-turn-1", "pending-send-m1"])
    })

    it("splits previews around the echo when both are present", () => {
        const echoes = pendingSendEchoMessages([echo("m1", "asked", 2, {executionId: "turn-2"})])
        const merged = mergePendingSendEchoRows(durable, echoes, [
            preview("turn-1"),
            preview("turn-2"),
        ])
        expect(merged.map((m) => m.id)).toEqual([
            "u1",
            "live-preview-turn-1",
            "pending-send-m1",
            "live-preview-turn-2",
        ])
    })
})

describe("mergePendingSendEchoRows before acknowledgement", () => {
    const durable = [user("u1", "saved")]

    it("keeps an unacknowledged echo below a preview it cannot attribute", () => {
        // Guessing would put an answer above its own question. With no execution id to match on,
        // the echo goes last: wrong for at most the previous answer, never for the new one.
        const echoes = pendingSendEchoMessages([echo("m1", "asked", 2)])
        const merged = mergePendingSendEchoRows(durable, echoes, [preview("turn-1")])
        expect(merged.map((m) => m.id)).toEqual(["u1", "live-preview-turn-1", "pending-send-m1"])
    })

    it("falls back for the whole group when only one echo is unacknowledged", () => {
        const echoes = pendingSendEchoMessages([
            echo("m1", "one", 2, {executionId: "turn-1"}),
            echo("m2", "two", 3),
        ])
        const merged = mergePendingSendEchoRows(durable, echoes, [preview("turn-1")])
        expect(merged.map((m) => m.id)).toEqual([
            "u1",
            "live-preview-turn-1",
            "pending-send-m1",
            "pending-send-m2",
        ])
    })
})

describe("retirePendingSendEchoes precedence", () => {
    it("lets a late saved row retire an echo already flagged as failed", () => {
        // The terminal-frame guess fires when the turn ends and the row has not been adopted.
        // Adoption can still land after that, and the row outranks the guess.
        const pending = [echo("m1", "mine", 2, {executionId: "turn-1", failed: true})]
        expect(retire(pending, 1, [])).toEqual(pending)
        expect(retire(pending, 1, ["turn-1"])).toEqual([])
    })

    it("keeps a flagged echo whose row never arrives", () => {
        const pending = [echo("m1", "mine", 2, {executionId: "turn-1", failed: true})]
        expect(retire(pending, 99, ["turn-other"])).toEqual(pending)
    })
})

describe("isPendingSendFailed", () => {
    it("is true only for an echo row whose send failed", () => {
        const [failed] = pendingSendEchoMessages([echo("m1", "hi", 3, {failed: true})])
        const [pending] = pendingSendEchoMessages([echo("m2", "hi", 3)])
        expect(isPendingSendFailed(failed)).toBe(true)
        expect(isPendingSendFailed(pending)).toBe(false)
        expect(isPendingSendFailed(user("u1", "saved"))).toBe(false)
    })

    it("carries a note that says what happened and what to do", () => {
        // Word for word what the composer shows for the other refusal shape.
        expect(PENDING_SEND_FAILED_NOTE).toBe("Message wasn't sent — try again.")
    })
})
