import {describe, expect, it, vi} from "vitest"

import {
    getPasswordlessAttemptState,
    isSamePasswordlessAttempt,
    syncInitialPasswordlessAttempt,
    type AgentaPasswordlessAttempt,
} from "./passwordlessAttempt"

const attempt = (
    overrides: Partial<AgentaPasswordlessAttempt> = {},
): AgentaPasswordlessAttempt => ({
    deviceId: "device-1",
    preAuthSessionId: "session-1",
    flowType: "USER_INPUT_CODE",
    contactInfo: "user@example.com",
    agentaApiUrl: "https://api.us.example.com",
    ...overrides,
})

describe("passwordlessAttempt", () => {
    it("resumes current-region attempts with an email", () => {
        expect(getPasswordlessAttemptState(attempt(), "https://api.us.example.com")).toEqual({
            status: "resume",
            email: "user@example.com",
        })
    })

    it("clears attempts from another region", () => {
        expect(
            getPasswordlessAttemptState(
                attempt({agentaApiUrl: "https://api.eu.example.com"}),
                "https://api.us.example.com",
            ),
        ).toEqual({status: "clear"})
    })

    it("clears orphaned attempts without the metadata needed to resume", () => {
        expect(
            getPasswordlessAttemptState(
                attempt({contactInfo: undefined, agentaApiUrl: undefined}),
                "https://api.us.example.com",
            ),
        ).toEqual({status: "clear"})
    })

    it("matches attempts by the SuperTokens identifiers before clearing", () => {
        expect(isSamePasswordlessAttempt(attempt(), attempt())).toBe(true)
        expect(isSamePasswordlessAttempt(attempt(), attempt({preAuthSessionId: "session-2"}))).toBe(
            false,
        )
    })

    it("does not clear when a delayed cleanup observes a newer attempt", async () => {
        const clearLoginAttemptInfo = vi.fn(async () => {})
        const result = await syncInitialPasswordlessAttempt({
            currentApiUrl: "https://api.us.example.com",
            getLoginAttemptInfo: vi
                .fn()
                .mockResolvedValueOnce(attempt({agentaApiUrl: "https://api.eu.example.com"}))
                .mockResolvedValueOnce(attempt({preAuthSessionId: "session-2"})),
            clearLoginAttemptInfo,
        })

        expect(result).toEqual({status: "clear", didClearAttempt: false})
        expect(clearLoginAttemptInfo).not.toHaveBeenCalled()
    })

    it("handles storage failures without throwing", async () => {
        const error = new Error("storage unavailable")
        const onError = vi.fn()

        await expect(
            syncInitialPasswordlessAttempt({
                currentApiUrl: "https://api.us.example.com",
                getLoginAttemptInfo: vi.fn().mockRejectedValue(error),
                clearLoginAttemptInfo: vi.fn(),
                onError,
            }),
        ).resolves.toEqual({status: "none"})
        expect(onError).toHaveBeenCalledWith(error)
    })
})
