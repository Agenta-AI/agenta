// @vitest-environment jsdom
/**
 * Regression for the increment-6 browser pass, round 8, item 2.
 *
 * A user typed while an approval card was open, approved, and the message went into the running
 * continuation: the runner superseded the continuation's warm sandbox, the approved
 * `sleep 25 && echo …` came back "Command aborted", and the message's own turn was declared lost.
 *
 * The records below are the REAL durable record log of that session
 * (9d40cfcc-6485-4250-8d2e-17f1f12f55f4), exported from the increment-6 stack and ordered exactly
 * as `GET /sessions/records` returns them (timestamp, then record index). Replaying them prefix by
 * prefix pins `ownsContinuation`: the tab that received the respond body's `execution.id` owns
 * the continuation from the answer until that execution's terminal record, including the 8.1 s
 * window before the continuation's first record (20:27:59 → 20:28:07), where the transcript alone
 * shows a paused turn whose gate is answered.
 */
import {act, renderHook} from "@testing-library/react"
import type {UIMessage} from "ai"
import {afterEach, describe, expect, it, vi} from "vitest"

import {transcriptToMessages} from "../../../src/assets/transcriptToMessages"
import {CONTINUATION_HOLD_MAX_MS, useAgentChatQueue} from "../../../src/hooks/useAgentChatQueue"
import records from "../assets/__fixtures__/heldMessageDuringContinuation.records.json"

/** The continuation execution the respond body named (`execution.id`). */
const CONTINUATION_EXECUTION_ID = "943f3c99-5816-4a46-b6e3-7a10fe587575"

/** Record indices in the fixture, by the event that closes each prefix. */
const AFTER_SOURCE_PAUSED_DONE = 5
const AFTER_CONTINUATION_FIRST_THOUGHT = 6
const AFTER_CONTINUATION_TOOL_CALL = 7
const AFTER_CONTINUATION_INTERACTION_RESPONSE = 8
const AFTER_CONTINUATION_DONE = 12

const messagesAfter = (count: number): UIMessage[] =>
    transcriptToMessages(records.slice(0, count) as never) ?? []

/** The hook as the desktop mounts it after a durable approve. */
const renderQueue = (initial: {messages: UIMessage[]; continuationExecutionId?: string | null}) =>
    renderHook(
        (props: {messages: UIMessage[]; continuationExecutionId?: string | null}) =>
            useAgentChatQueue({
                messages: props.messages,
                stopped: false,
                server: {
                    busy: false,
                    queued: [],
                    submit: vi.fn().mockResolvedValue("running"),
                    remove: vi.fn().mockResolvedValue(undefined),
                },
                ...(props.continuationExecutionId !== undefined
                    ? {continuationExecutionId: props.continuationExecutionId}
                    : {}),
            }),
        {initialProps: initial},
    )

afterEach(() => {
    vi.useRealTimers()
})

describe("the durable continuation belongs to the tab that started it", () => {
    it("keeps continuation ownership only in the tab that received the respond execution id", () => {
        const answering = renderQueue({
            messages: messagesAfter(AFTER_SOURCE_PAUSED_DONE),
            continuationExecutionId: CONTINUATION_EXECUTION_ID,
        })
        const observer = renderQueue({
            messages: messagesAfter(AFTER_SOURCE_PAUSED_DONE),
            continuationExecutionId: null,
        })

        expect(answering.result.current.ownsContinuation).toBe(true)
        expect(observer.result.current.ownsContinuation).toBe(false)

        for (const count of [
            AFTER_CONTINUATION_FIRST_THOUGHT,
            AFTER_CONTINUATION_TOOL_CALL,
            AFTER_CONTINUATION_INTERACTION_RESPONSE,
        ]) {
            const messages = messagesAfter(count)
            answering.rerender({
                messages,
                continuationExecutionId: CONTINUATION_EXECUTION_ID,
            })
            observer.rerender({messages, continuationExecutionId: null})

            expect(
                answering.result.current.ownsContinuation,
                `answering tab lost ownership after record ${count}`,
            ).toBe(true)
            expect(
                observer.result.current.ownsContinuation,
                `observer claimed ownership after record ${count}`,
            ).toBe(false)
        }

        answering.rerender({
            messages: messagesAfter(AFTER_CONTINUATION_DONE),
            continuationExecutionId: CONTINUATION_EXECUTION_ID,
        })
        expect(answering.result.current.ownsContinuation).toBe(false)
    })

    it("owns the continuation on the execution id alone, before it writes its first record", () => {
        // The 8.1-second window between the answer and the continuation's first record. Nothing
        // in the transcript says a continuation exists; only the respond body does.
        const {result} = renderQueue({
            messages: messagesAfter(AFTER_SOURCE_PAUSED_DONE),
            continuationExecutionId: CONTINUATION_EXECUTION_ID,
        })
        expect(result.current.ownsContinuation).toBe(true)
    })

    it("owns nothing in that same window when no continuation was started", () => {
        // The guard must be the execution id, not the paused shape: an approval whose respond
        // returned no execution has nothing to wait for.
        const {result} = renderQueue({
            messages: messagesAfter(AFTER_SOURCE_PAUSED_DONE),
            continuationExecutionId: null,
        })
        expect(result.current.ownsContinuation).toBe(false)
    })

    it("gives up the id-keyed hold at the ceiling, so an undelivered continuation cannot hold forever", () => {
        vi.useFakeTimers()
        const {result} = renderQueue({
            messages: messagesAfter(AFTER_SOURCE_PAUSED_DONE),
            continuationExecutionId: CONTINUATION_EXECUTION_ID,
        })
        expect(result.current.ownsContinuation).toBe(true)

        act(() => {
            vi.advanceTimersByTime(CONTINUATION_HOLD_MAX_MS + 1)
        })
        expect(result.current.ownsContinuation).toBe(false)
    })

    it("keeps ownership past the ceiling while the transcript still shows the continuation running", () => {
        vi.useFakeTimers()
        const {rerender, result} = renderQueue({
            messages: messagesAfter(AFTER_CONTINUATION_FIRST_THOUGHT),
            continuationExecutionId: CONTINUATION_EXECUTION_ID,
        })
        act(() => {
            vi.advanceTimersByTime(CONTINUATION_HOLD_MAX_MS + 1)
        })
        expect(result.current.ownsContinuation).toBe(true)

        rerender({
            messages: messagesAfter(AFTER_CONTINUATION_DONE),
            continuationExecutionId: CONTINUATION_EXECUTION_ID,
        })
        expect(result.current.ownsContinuation).toBe(false)
    })
})
