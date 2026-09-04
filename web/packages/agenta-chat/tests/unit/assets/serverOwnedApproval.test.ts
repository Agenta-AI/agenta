import {describe, expect, it, vi} from "vitest"

import {submitServerOwnedApproval} from "../../../src/assets/serverOwnedApproval"

describe("submitServerOwnedApproval", () => {
    it("retires local resume ownership after a successful response", async () => {
        const retire = vi.fn()

        await expect(
            submitServerOwnedApproval({submit: () => Promise.resolve("accepted"), retire}),
        ).resolves.toBe("accepted")
        expect(retire).toHaveBeenCalledOnce()
    })

    it("retires local resume ownership when a committed response may have been lost", async () => {
        const retire = vi.fn()
        const lostResponse = new Error("connection closed")

        await expect(
            submitServerOwnedApproval({submit: () => Promise.reject(lostResponse), retire}),
        ).rejects.toBe(lostResponse)
        expect(retire).toHaveBeenCalledOnce()
    })
})
