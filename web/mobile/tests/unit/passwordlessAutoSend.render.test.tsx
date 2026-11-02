// @vitest-environment jsdom
import {act, StrictMode} from "react"

import {PasswordlessRequestForm, type AuthSecurityAdapter} from "@agenta/auth-ui"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

const auth = vi.hoisted(() => ({requestEmailCode: vi.fn(() => Promise.resolve({kind: "ok"}))}))

vi.mock("@agenta/auth", async (original) => ({
    ...(await original<object>()),
    requestEmailCode: auth.requestEmailCode,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined

const render = async (props: Partial<Parameters<typeof PasswordlessRequestForm>[0]>) => {
    const onCodeSent = vi.fn()
    const view = (next: typeof props) => (
        <StrictMode>
            <PasswordlessRequestForm
                email="new@example.test"
                setEmail={() => undefined}
                message={{}}
                setMessage={() => undefined}
                onCodeSent={onCodeSent}
                lockEmail
                {...next}
            />
        </StrictMode>
    )
    root ??= createRoot(document.createElement("div"))
    await act(async () => root!.render(view(props)))
    return {onCodeSent, rerender: (next: typeof props) => act(async () => root!.render(view(next)))}
}

const security = (hasToken: boolean): AuthSecurityAdapter => ({
    hasToken,
    ensureToken: () => (hasToken ? "token" : null),
    stampToken: () => undefined,
    clearToken: () => undefined,
    refreshToken: () => Promise.resolve(null),
    widget: null,
})

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    vi.clearAllMocks()
})

describe("sending a sign-in code without a click", () => {
    it("sends the code once on mount and moves on to the code step", async () => {
        const {onCodeSent} = await render({autoSend: true})
        expect(auth.requestEmailCode).toHaveBeenCalledOnce()
        expect(auth.requestEmailCode).toHaveBeenCalledWith("new@example.test")
        expect(onCodeSent).toHaveBeenCalledOnce()
    })

    it("waits for the security check before sending, then sends once", async () => {
        const {rerender} = await render({autoSend: true, security: security(false)})
        expect(auth.requestEmailCode).not.toHaveBeenCalled()
        await rerender({autoSend: true, security: security(true)})
        await rerender({autoSend: true, security: security(true)})
        expect(auth.requestEmailCode).toHaveBeenCalledOnce()
    })

    it("leaves the send to the button when other methods are on offer", async () => {
        await render({autoSend: false})
        expect(auth.requestEmailCode).not.toHaveBeenCalled()
    })
})
