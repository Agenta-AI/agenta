import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {
    createUserStoppedState,
    isSessionTurnStopping,
    lastTurnWasUserStopped,
    reduceUserStoppedState,
    type UserStoppedState,
    type UserStoppedStateEvent,
} from "../../../src/model/userStop"

const assistant = (metadata?: Record<string, unknown>): UIMessage =>
    ({id: "a1", role: "assistant", parts: [], metadata}) as UIMessage

const approval = {
    id: "a1",
    role: "assistant" as const,
    parts: [
        {
            type: "tool-shell",
            toolCallId: "call-1",
            state: "approval-requested",
            approval: {id: "approval-1"},
            input: {},
        },
    ],
} as UIMessage

const clientInteraction = {
    id: "a2",
    role: "assistant" as const,
    parts: [
        {
            type: "tool-request_input",
            toolCallId: "call-2",
            state: "input-available",
            input: {},
        },
    ],
} as UIMessage

const reduce = (
    event: UserStoppedStateEvent,
    state: UserStoppedState = createUserStoppedState([]),
) => reduceUserStoppedState(state, event)

describe("user stopped state", () => {
    it("keeps a remounted turn guarded until its durable Stop settles", () => {
        expect(
            isSessionTurnStopping({currentTurnId: "turn-1", stoppingTurnId: "turn-1"}),
        ).toBe(true)
        expect(isSessionTurnStopping({currentTurnId: "turn-1", stoppingTurnId: null})).toBe(
            false,
        )
    })

    it("does not apply a stale Stop marker to a newer turn", () => {
        expect(
            isSessionTurnStopping({currentTurnId: "turn-2", stoppingTurnId: "turn-1"}),
        ).toBe(false)
    })

    it("maps a stream-delivered cancelled ending to the neutral state", () => {
        expect(
            reduce({
                type: "stream-terminal",
                finishReason: "other",
                messages: [assistant()],
            }).stopped,
        ).toBe(true)
    })

    it("does not mistake a paused approval for a cancellation", () => {
        expect(
            reduce({
                type: "stream-terminal",
                finishReason: "other",
                messages: [approval],
            }).stopped,
        ).toBe(false)
    })

    it("does not mistake a parked client interaction for a cancellation", () => {
        expect(
            reduce({
                type: "stream-terminal",
                finishReason: "other",
                messages: [clientInteraction],
            }).stopped,
        ).toBe(false)
    })

    it("maps a replayed cancelled turn to the neutral state", () => {
        const messages = [assistant({runStopped: true})]

        expect(lastTurnWasUserStopped(messages)).toBe(true)
        expect(reduce({type: "transcript", messages}).stopped).toBe(true)
    })

    it("keeps genuine stream failures non-neutral", () => {
        expect(
            reduce({
                type: "stream-terminal",
                finishReason: "error",
                messages: [assistant()],
            }).stopped,
        ).toBe(false)
    })

    it("clears the marker when a new turn starts", () => {
        const state = reduce({type: "user-stop"}, createUserStoppedState([assistant()]))
        expect(reduce({type: "reset"}, state).stopped).toBe(false)
    })

    it("keeps the local latch while the same stopped turn changes in place", () => {
        const stoppedTurn = assistant({turnId: "turn-1"})
        const state = reduce({type: "user-stop"}, createUserStoppedState([stoppedTurn]))

        expect(reduce({type: "transcript", messages: [stoppedTurn]}, state).stopped).toBe(true)
    })

    it("clears the latch when revalidation adopts a newer resumed turn", () => {
        const state = reduce(
            {type: "user-stop"},
            createUserStoppedState([assistant({turnId: "turn-1"})]),
        )
        const resumedTurn = assistant({turnId: "turn-2"})

        expect(reduce({type: "transcript", messages: [resumedTurn]}, state).stopped).toBe(false)
    })
})
