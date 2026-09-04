// @vitest-environment jsdom
/**
 * Regression for the increment-6 browser pass, round 8, item 2.
 *
 * A user typed while an approval card was open, approved, and the client held the message for
 * about sixteen seconds. Then it sent it into the running continuation: the runner superseded the
 * continuation's warm sandbox, the approved `sleep 25 && echo …` came back "Command aborted", and
 * the released message's own turn was declared lost. The user lost both.
 *
 * The records below are the REAL durable record log of that session
 * (9d40cfcc-6485-4250-8d2e-17f1f12f55f4), exported from the increment-6 stack and ordered exactly
 * as `GET /sessions/records` returns them (timestamp, then record index). Replaying them prefix by
 * prefix is what pins the two holes the round-8 fix left open:
 *
 *  1. `resumeOrphaned` walked around the gate. `canReleaseQueuedMessage` holds correctly on
 *     `approvalContinuation.state === "running"`, but the hook ORs that gate with the orphan
 *     escape hatch, and a durable answer makes the hatch true every time: the answer retires the
 *     local gate marker, and the first adopted server transcript makes the tail a restored
 *     "resume imminent" message.
 *  2. The transcript-derived hold starts too late. `approvalContinuation` is stamped from the
 *     continuation's FIRST record, which landed 8.1 s after the answer here (20:27:59 → 20:28:07).
 *     A transcript adopted inside that gap shows a paused turn whose gate is answered — settled,
 *     by every predicate. The respond body's `execution.id` covers that window.
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

/**
 * The hook exactly as the desktop mounts it after a durable approve: the answer left no live gate
 * marker, so the conversation's `resumeOrphaned` is true, and the stream itself has been "ready"
 * since the turn paused. Only the continuation hold can stop a release here.
 */
const renderQueue = (initial: {messages: UIMessage[]; continuationExecutionId?: string | null}) => {
    const sendQueued = vi.fn()
    const view = renderHook(
        (props: {messages: UIMessage[]; continuationExecutionId?: string | null}) =>
            useAgentChatQueue({
                status: "ready",
                messages: props.messages,
                stopped: false,
                resumeOrphaned: true,
                sendQueued,
                ...(props.continuationExecutionId !== undefined
                    ? {continuationExecutionId: props.continuationExecutionId}
                    : {}),
            }),
        {initialProps: initial},
    )
    act(() => {
        view.result.current.submit({text: "Then reply with the marker inc6-r8-held."})
    })
    return {...view, sendQueued}
}

afterEach(() => {
    vi.useRealTimers()
})

describe("a held message must outlive the durable continuation", () => {
    it("holds through every continuation record and releases on its terminal one", () => {
        const {rerender, result, sendQueued} = renderQueue({
            messages: messagesAfter(AFTER_SOURCE_PAUSED_DONE),
            continuationExecutionId: CONTINUATION_EXECUTION_ID,
        })
        expect(sendQueued).not.toHaveBeenCalled()
        expect(result.current.queued).toHaveLength(1)

        // The prefixes the browser really walked through, in order. The last one is where the
        // round-8 build sent: the continuation's re-raised tool call and its interaction response
        // together make the tail read as settled to every predicate that ignores the execution.
        for (const count of [
            AFTER_CONTINUATION_FIRST_THOUGHT,
            AFTER_CONTINUATION_TOOL_CALL,
            AFTER_CONTINUATION_INTERACTION_RESPONSE,
        ]) {
            rerender({
                messages: messagesAfter(count),
                continuationExecutionId: CONTINUATION_EXECUTION_ID,
            })
            expect(sendQueued, `released after record ${count}`).not.toHaveBeenCalled()
            expect(result.current.queued).toHaveLength(1)
        }

        rerender({
            messages: messagesAfter(AFTER_CONTINUATION_DONE),
            continuationExecutionId: CONTINUATION_EXECUTION_ID,
        })
        expect(sendQueued).toHaveBeenCalledOnce()
        expect(sendQueued.mock.calls[0][0]).toMatchObject({
            text: "Then reply with the marker inc6-r8-held.",
        })
        expect(result.current.queued).toHaveLength(0)
    })

    it("holds on the execution id alone, before the continuation writes its first record", () => {
        // The 8.1-second window between the answer and the continuation's first record. Nothing
        // in the transcript says a continuation exists; only the respond body does.
        const paused = messagesAfter(AFTER_SOURCE_PAUSED_DONE)
        const {result, sendQueued} = renderQueue({
            messages: paused,
            continuationExecutionId: CONTINUATION_EXECUTION_ID,
        })
        expect(sendQueued).not.toHaveBeenCalled()
        expect(result.current.queued).toHaveLength(1)
    })

    it("releases in that same window when no continuation was started", () => {
        // The guard must be the execution id, not the paused shape: an approval whose respond
        // returned no execution has nothing to wait for, and holding it would strand the queue.
        const {sendQueued} = renderQueue({
            messages: messagesAfter(AFTER_SOURCE_PAUSED_DONE),
            continuationExecutionId: null,
        })
        expect(sendQueued).toHaveBeenCalledOnce()
    })

    it("gives up the id-keyed hold at the ceiling, so an undelivered continuation cannot strand the queue", () => {
        vi.useFakeTimers()
        const {result, sendQueued} = renderQueue({
            messages: messagesAfter(AFTER_SOURCE_PAUSED_DONE),
            continuationExecutionId: CONTINUATION_EXECUTION_ID,
        })
        expect(sendQueued).not.toHaveBeenCalled()

        act(() => {
            vi.advanceTimersByTime(CONTINUATION_HOLD_MAX_MS + 1)
        })
        expect(sendQueued).toHaveBeenCalledOnce()
        expect(result.current.queued).toHaveLength(0)
    })

    it("keeps holding past the ceiling while the transcript still shows the continuation running", () => {
        vi.useFakeTimers()
        const {rerender, sendQueued} = renderQueue({
            messages: messagesAfter(AFTER_CONTINUATION_FIRST_THOUGHT),
            continuationExecutionId: CONTINUATION_EXECUTION_ID,
        })
        act(() => {
            vi.advanceTimersByTime(CONTINUATION_HOLD_MAX_MS + 1)
        })
        expect(sendQueued).not.toHaveBeenCalled()

        rerender({
            messages: messagesAfter(AFTER_CONTINUATION_DONE),
            continuationExecutionId: CONTINUATION_EXECUTION_ID,
        })
        expect(sendQueued).toHaveBeenCalledOnce()
    })
})
