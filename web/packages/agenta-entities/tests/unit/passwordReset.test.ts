import {beforeEach, describe, expect, it, vi} from "vitest"

const resetUserPassword = vi.hoisted(() => vi.fn())

vi.mock("@agenta/sdk/resources", () => ({
    getUsersClient: () => ({resetUserPassword}),
}))

import {requestPasswordReset, resetPassword} from "../../src/profile"

describe("password reset", () => {
    beforeEach(() => resetUserPassword.mockReset())

    it("resolves to the link the backend returns", async () => {
        resetUserPassword.mockResolvedValue("https://reset.example.com/one-time")
        await expect(requestPasswordReset("user-2")).resolves.toBe(
            "https://reset.example.com/one-time",
        )
        expect(resetUserPassword).toHaveBeenCalledWith({user_id: "user-2"})
    })

    it("resolves to null when the backend emailed the link", async () => {
        resetUserPassword.mockResolvedValue(null)
        await expect(requestPasswordReset("user-2")).resolves.toBeNull()
    })

    it("rejects an answer that is neither a link nor null", async () => {
        resetUserPassword.mockResolvedValue({detail: "x"})
        await expect(requestPasswordReset("user-2")).rejects.toThrow("unexpected response")
    })

    it("keeps resetPassword string-only for callers that need a link", async () => {
        resetUserPassword.mockResolvedValue(null)
        await expect(resetPassword("user-2")).rejects.toThrow("unexpected response")
    })
})
