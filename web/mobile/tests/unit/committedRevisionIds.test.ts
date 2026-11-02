import {describe, expect, it} from "vitest"

import {committedRevisionIds} from "@/features/chat/committedRevisionIds"

const part = (type: string, data?: unknown) => ({type, data})

describe("committedRevisionIds", () => {
    // The backend emits this part whenever the agent commits itself; the workspace has to
    // follow it, or the config pane and the version chip keep showing the superseded revision.
    it("reads the committed revision off the stream part, in order, once each", () => {
        const messages = [
            {parts: [part("text", "hi"), part("data-committed-revision", {revisionId: "r2"})]},
            {
                parts: [
                    part("data-committed-revision", {revisionId: "r2"}),
                    part("data-committed-revision", {revisionId: "r3", version: "3"}),
                ],
            },
        ]
        expect(committedRevisionIds(messages)).toEqual(["r2", "r3"])
    })

    it("ignores every other part, and a commit part with no id", () => {
        expect(
            committedRevisionIds([
                {parts: [part("data-trace", {revisionId: "no"}), part("data-committed-revision")]},
            ]),
        ).toEqual([])
    })
})
