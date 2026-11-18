import {beforeEach, describe, expect, it, vi} from "vitest"

const consumeCode = vi.fn()
const signUp = vi.fn()

vi.mock("supertokens-web-js/recipe/passwordless", () => ({
    default: {init: vi.fn(), consumeCode: (...args: unknown[]) => consumeCode(...args)},
}))
vi.mock("supertokens-web-js/recipe/emailpassword", () => ({
    default: {init: vi.fn(), signUp: (...args: unknown[]) => signUp(...args)},
}))

const {signUpDetailed, submitEmailCodeDetailed} = await import("../../src/client")

describe("submitEmailCodeDetailed", () => {
    beforeEach(() => {
        consumeCode.mockReset()
    })

    it("keeps the attempt open when the browser is offline", async () => {
        consumeCode.mockRejectedValue(new TypeError("Failed to fetch"))
        expect(await submitEmailCodeDetailed("123456")).toEqual({
            kind: "failed",
            failure: "unreachable",
        })
    })

    it("keeps the attempt open on a rate limit or a server error", async () => {
        consumeCode.mockRejectedValue(new Response(null, {status: 429}))
        expect(await submitEmailCodeDetailed("123456")).toEqual({
            kind: "failed",
            failure: "rate-limited",
        })
        consumeCode.mockRejectedValue(new Response(null, {status: 503}))
        expect(await submitEmailCodeDetailed("123456")).toEqual({
            kind: "failed",
            failure: "server",
        })
    })

    it("restarts the flow on any other thrown error", async () => {
        consumeCode.mockRejectedValue(new Response(null, {status: 400}))
        expect(await submitEmailCodeDetailed("123456")).toEqual({kind: "restart"})
    })

    it("restarts the flow when SuperTokens says the attempt is gone", async () => {
        consumeCode.mockResolvedValue({status: "RESTART_FLOW_ERROR"})
        expect(await submitEmailCodeDetailed("123456")).toEqual({kind: "restart"})
    })
})

describe("signUpDetailed", () => {
    beforeEach(() => {
        signUp.mockReset()
    })

    it("does not report a wrong password on an existing email as a network failure", async () => {
        // The API answers this sign-up with WRONG_CREDENTIALS_ERROR and no user, and
        // supertokens-web-js throws while it reads the user.
        signUp.mockRejectedValue(
            new TypeError("Cannot use 'in' operator to search for 'loginMethods' in undefined"),
        )
        expect(await signUpDetailed("a@b.co", "wrong-password")).toEqual({
            kind: "error",
            failure: "unknown",
        })
    })
})
