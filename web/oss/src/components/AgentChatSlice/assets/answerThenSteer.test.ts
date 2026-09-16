/**
 * The approval click keeps the submission outcome.
 *
 * The dock decides between "Answer saved, retry needed" and "Answered, waiting for the agent" from
 * the `recoverable` flag on the value this wrapper resolves to. A wrapper that answered the gate
 * and resolved to `undefined` showed a healthy card over a continuation the server could not
 * deliver, which is the state the user has to act on.
 */
import {describe, expect, it, vi} from "vitest"

import {answerThenSteer} from "./answerThenSteer"

describe("answerThenSteer", () => {
    it("resolves to the submission outcome, so a recoverable answer reaches the card", async () => {
        const outcome = await answerThenSteer({
            approved: true,
            answer: async () => ({durable: true, recoverable: true}),
            steer: () => undefined,
        })

        expect(outcome).toEqual({durable: true, recoverable: true})
    })

    it("still resolves to the outcome when a denial also sends a steer note", async () => {
        const steer = vi.fn()

        const outcome = await answerThenSteer({
            approved: false,
            message: "  use the staging bucket  ",
            answer: async () => ({durable: true, recoverable: false}),
            steer,
        })

        expect(outcome).toEqual({durable: true, recoverable: false})
        expect(steer).toHaveBeenCalledWith("use the staging bucket")
    })

    it("sends the steer note only after the answer, and only on a denial", async () => {
        const order: string[] = []
        const steer = vi.fn(() => order.push("steer"))

        await answerThenSteer({
            approved: false,
            message: "stop",
            answer: async () => {
                order.push("answer")
            },
            steer,
        })
        expect(order).toEqual(["answer", "steer"])

        steer.mockClear()
        await answerThenSteer({
            approved: true,
            message: "stop",
            answer: async () => undefined,
            steer,
        })
        expect(steer).not.toHaveBeenCalled()
    })

    it("ignores a blank note", async () => {
        const steer = vi.fn()

        await answerThenSteer({
            approved: false,
            message: "   ",
            answer: async () => undefined,
            steer,
        })

        expect(steer).not.toHaveBeenCalled()
    })
})
