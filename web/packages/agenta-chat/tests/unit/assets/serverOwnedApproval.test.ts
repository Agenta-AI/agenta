import {describe, expect, it, vi} from "vitest"

import {
    submitApprovalForCapability,
    submitServerOwnedApproval,
} from "../../../src/assets/serverOwnedApproval"

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

describe("submitApprovalForCapability", () => {
    it("uses the legacy row transition and local gate release when capability is off", async () => {
        const submitDurable = vi.fn()
        const retireDurable = vi.fn()
        const recordLegacy = vi.fn().mockResolvedValue(undefined)
        const releaseLegacy = vi.fn()

        await expect(
            submitApprovalForCapability({
                durableApprovals: false,
                submitDurable,
                retireDurable,
                recordLegacy,
                releaseLegacy,
            }),
        ).resolves.toEqual({durable: false, recoverable: false})

        expect(submitDurable).not.toHaveBeenCalled()
        expect(retireDurable).not.toHaveBeenCalled()
        expect(recordLegacy).toHaveBeenCalledOnce()
        expect(releaseLegacy).toHaveBeenCalledOnce()
    })
})
