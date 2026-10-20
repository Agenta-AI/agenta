// The Claude connect dialog: a pasted token, checked by the API, and never a device login.
import {act} from "react"

import type {ProviderConnection, SecretKind} from "@agenta/entities/secret"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {SubscriptionSignInDialog} from "../../src/secretProvider/SubscriptionSignInDialog"

const {CREATE_ATOM, SET_TOKEN_ATOM, START_LOGIN_ATOM, createConnection, setToken, startLogin} =
    vi.hoisted(() => ({
        CREATE_ATOM: {key: "create"},
        SET_TOKEN_ATOM: {key: "set-token"},
        START_LOGIN_ATOM: {key: "start-login"},
        createConnection: vi.fn(),
        setToken: vi.fn(),
        startLogin: vi.fn(),
    }))

vi.mock("@agenta/entities/secret", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/secret")>()),
    createSubscriptionConnectionAtom: CREATE_ATOM,
    setSubscriptionTokenAtom: SET_TOKEN_ATOM,
    startSubscriptionLoginAtom: START_LOGIN_ATOM,
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => ({data: undefined, error: null}),
    useSetAtom: (atom: unknown) => {
        if (atom === CREATE_ATOM) return createConnection
        if (atom === SET_TOKEN_ATOM) return setToken
        if (atom === START_LOGIN_ATOM) return startLogin
        return vi.fn(() => Promise.resolve())
    },
}))

const TOKEN = "sk-ant-oat01-abcdef"

const claudeConnection = (loginState: string): ProviderConnection => ({
    id: "claude-1",
    slug: "claude",
    name: "Claude",
    kind: "anthropic",
    title: "Claude",
    secretKind: "subscription_provider" as SecretKind,
    models: ["sonnet"],
    harnesses: ["claude"],
    hasStoredCredential: loginState !== "pending_login",
    subscription: {provider: "claude", loginState},
    source: {name: "Claude", provider: "claude"} as ProviderConnection["source"],
})

/** A Fern error carrying the API's `{code, message, retryable, next_step}` refusal. */
const refusal = (code: string, message: string, nextStep: string) =>
    Object.assign(new Error("Status code: 422"), {
        statusCode: 422,
        body: {detail: {code, message, retryable: false, next_step: nextStep}},
    })

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const onClose = vi.fn()

const render = async (provider: string, connection: ProviderConnection | null = null) => {
    await act(async () => {
        root.render(
            <SubscriptionSignInDialog
                open
                onClose={onClose}
                provider={provider}
                connection={connection}
            />,
        )
    })
}

const text = () => document.body.textContent ?? ""

const button = (label: string): HTMLButtonElement => {
    const found = [...document.querySelectorAll("button")].find(
        (item) => item.textContent?.trim() === label,
    )
    expect(found, `no button "${label}"`).toBeDefined()
    return found as HTMLButtonElement
}

const type = async (value: string) => {
    const input = document.querySelector("input") as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
        setter.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

const press = async (label: string) => {
    await act(async () => {
        button(label).click()
    })
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    onClose.mockReset()
    createConnection.mockReset().mockResolvedValue("claude-1")
    setToken.mockReset().mockResolvedValue(undefined)
    startLogin.mockReset().mockResolvedValue({
        attempt_id: "attempt-1",
        state: "pending",
        user_code: "ABCD-1234",
        verification_uri: "https://auth.example.test/device",
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
})

describe("opening the connect dialog", () => {
    it("starts a device login for ChatGPT", async () => {
        await render("chatgpt")
        expect(startLogin).toHaveBeenCalledOnce()
    })

    it("starts no device login and creates nothing for Claude", async () => {
        await render("claude")

        expect(startLogin).not.toHaveBeenCalled()
        expect(createConnection).not.toHaveBeenCalled()
        expect(text()).toContain("Connect Claude")
        expect(text()).toContain("claude setup-token")
        expect(text()).toContain("You need Claude Code installed.")
    })
})

describe("the token steps", () => {
    it("keeps Connect off until the field holds a setup-token", async () => {
        await render("claude")
        expect(button("Connect").disabled).toBe(true)

        await type("not-a-token")
        expect(button("Connect").disabled).toBe(true)

        await type(TOKEN)
        expect(button("Connect").disabled).toBe(false)
    })

    it("says Checking while the API checks the token", async () => {
        let finish: () => void = () => undefined
        setToken.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
        await render("claude")
        await type(TOKEN)

        await press("Connect")

        expect(button("Checking…").disabled).toBe(true)
        await act(async () => finish())
    })

    it("creates the connection, then stores the token on it", async () => {
        await render("claude")
        await type(TOKEN)
        await press("Connect")

        expect(createConnection).toHaveBeenCalledWith({provider: "claude", name: "Claude"})
        expect(setToken).toHaveBeenCalledWith({secretId: "claude-1", token: TOKEN})
    })

    it("shows the API's refusal and reuses the same connection on retry", async () => {
        setToken.mockRejectedValueOnce(
            refusal(
                "subscription_token_rejected",
                "Claude did not accept this token.",
                "Run `claude setup-token` again and paste the new token.",
            ),
        )
        await render("claude")
        await type(TOKEN)
        await press("Connect")

        expect(text()).toContain(
            "Claude did not accept this token. Run claude setup-token again and paste the new token.",
        )
        expect(document.querySelector("input")?.getAttribute("aria-invalid")).toBe("true")

        await press("Connect")

        expect(createConnection).toHaveBeenCalledOnce()
        expect(setToken).toHaveBeenLastCalledWith({secretId: "claude-1", token: TOKEN})
    })

    it("asks for a retry when the token could not be checked", async () => {
        setToken.mockRejectedValueOnce(
            refusal(
                "subscription_token_unverified",
                "Agenta could not check this token with Claude.",
                "Try again in a moment.",
            ),
        )
        await render("claude")
        await type(TOKEN)
        await press("Connect")

        expect(text()).toContain(
            "Agenta could not check this token with Claude. Try again in a moment.",
        )
    })

    it("opens a ready connection on its status, and replaces the token on the same row", async () => {
        await render("claude", claudeConnection("ready"))

        expect(text()).toContain("Claude connected")
        expect(text()).toContain("Ready. Pick a Claude model in any agent.")
        expect(text()).not.toContain("expires")

        await press("Replace token")
        await type(TOKEN)
        await press("Connect")

        expect(createConnection).not.toHaveBeenCalled()
        expect(setToken).toHaveBeenCalledWith({secretId: "claude-1", token: TOKEN})
    })

    it("keeps the steps open on a refused replacement", async () => {
        setToken.mockRejectedValueOnce(
            refusal(
                "subscription_token_rejected",
                "Claude did not accept this token.",
                "Run `claude setup-token` again and paste the new token.",
            ),
        )
        await render("claude", claudeConnection("ready"))
        await press("Replace token")
        await type(TOKEN)
        await press("Connect")

        expect(text()).toContain("Claude did not accept this token.")
        expect(text()).not.toContain("Ready. Pick a Claude model in any agent.")
    })

    it("cannot be dismissed while a check is in flight", async () => {
        let finish: () => void = () => undefined
        createConnection.mockReturnValue(
            new Promise<string>((resolve) => (finish = () => resolve("claude-1"))),
        )
        await render("claude")
        await type(TOKEN)
        await press("Connect")

        expect(button("Cancel").disabled).toBe(true)
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
        })
        expect(onClose).not.toHaveBeenCalled()
        expect(text()).toContain("Checking…")

        // The check answers, then the dialog closes normally.
        await act(async () => finish())
        expect(setToken).toHaveBeenCalledWith({secretId: "claude-1", token: TOKEN})
        await press("Cancel")
        expect(onClose).toHaveBeenCalledOnce()
    })
})
