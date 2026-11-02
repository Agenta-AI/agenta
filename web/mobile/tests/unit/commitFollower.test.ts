import {describe, expect, it, vi} from "vitest"

import {createCommitFollower} from "@/features/chat/commitFollower"

const follower = (visible: {value: boolean}) => {
    const apply = vi.fn()
    return {apply, commits: createCommitFollower({apply, isVisible: () => visible.value})}
}

describe("createCommitFollower", () => {
    it("applies a commit at once while the tab is visible, and only once", () => {
        const visible = {value: true}
        const {apply, commits} = follower(visible)

        commits.report("revision-39")
        commits.report("revision-39")

        expect(apply).toHaveBeenCalledTimes(1)
        expect(apply).toHaveBeenCalledWith("revision-39")
    })

    it("holds a commit that arrives while the tab is hidden and applies it on return", () => {
        const visible = {value: false}
        const {apply, commits} = follower(visible)

        commits.report("revision-39")
        // The reader re-reports the same commit when it hydrates again; it stays one commit.
        commits.report("revision-39")
        commits.flush()
        expect(apply).not.toHaveBeenCalled()

        visible.value = true
        commits.flush()
        commits.flush()
        expect(apply).toHaveBeenCalledTimes(1)
        expect(apply).toHaveBeenCalledWith("revision-39")
    })

    it("applies only the newest of several commits made while hidden", () => {
        const visible = {value: false}
        const {apply, commits} = follower(visible)

        commits.report("revision-39")
        commits.report("revision-40")
        visible.value = true
        commits.flush()

        expect(apply.mock.calls).toEqual([["revision-40"]])
    })

    it("drops a held commit once a newer one is applied while visible", () => {
        const visible = {value: false}
        const {apply, commits} = follower(visible)

        commits.report("revision-39")
        visible.value = true
        commits.report("revision-40")
        commits.flush()

        expect(apply.mock.calls).toEqual([["revision-40"]])
    })
})
