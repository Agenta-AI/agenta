// The subscription views with their owner's connections: Claude's pasted token, checked by the
// API and never a device login, and an organization subscription's projects.
import {act} from "react"

import type {ProviderConnection, SecretKind} from "@agenta/entities/secret"
import {createRoot} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {waitFor} from "./domHelpers"
import {loadSubscriptionViews, SubscriptionViewStage} from "./subscriptionViewHarness"

const {
    CREATE_ATOM,
    SET_TOKEN_ATOM,
    START_LOGIN_ATOM,
    SET_PROJECTS_ATOM,
    createConnection,
    setToken,
    startLogin,
    setProjects,
} = vi.hoisted(() => ({
    CREATE_ATOM: {key: "create"},
    SET_TOKEN_ATOM: {key: "set-token"},
    START_LOGIN_ATOM: {key: "start-login"},
    SET_PROJECTS_ATOM: {key: "set-projects"},
    createConnection: vi.fn(),
    setToken: vi.fn(),
    startLogin: vi.fn(),
    setProjects: vi.fn(),
}))

vi.mock("@agenta/entities/secret", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/secret")>()),
    createSubscriptionConnectionAtom: CREATE_ATOM,
    setSubscriptionTokenAtom: SET_TOKEN_ATOM,
    startSubscriptionLoginAtom: START_LOGIN_ATOM,
    setOrganizationConnectionProjectsAtom: SET_PROJECTS_ATOM,
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => ({data: undefined, error: null}),
    useSetAtom: (atom: unknown) => {
        if (atom === CREATE_ATOM) return createConnection
        if (atom === SET_TOKEN_ATOM) return setToken
        if (atom === START_LOGIN_ATOM) return startLogin
        if (atom === SET_PROJECTS_ATOM) return setProjects
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

const ACME = {
    name: "Acme",
    projects: [
        {id: "support", name: "Support"},
        {id: "sales", name: "Sales"},
    ],
    projectChoice: "choose" as const,
}

const render = async (
    provider: string,
    connection: ProviderConnection | null = null,
    organization?: typeof ACME,
) => {
    await act(async () => {
        root.render(
            <SubscriptionViewStage
                provider={provider}
                connection={connection}
                organization={organization}
            />,
        )
    })
    await waitFor(() => expect(text()).toContain("depth:1"))
}

/** The stack went back to its root: the view closed. */
const closed = () => waitFor(() => expect(text()).toContain("depth:0"))

/** The same connection, owned by the organization and open to every project. */
const organizationConnection = (connection: ProviderConnection): ProviderConnection => ({
    ...connection,
    scope: "organization",
    availability: "all_projects",
    selectedProjectIds: [],
})

const chooseSelectedProjects = async () => {
    const selected = [...document.querySelectorAll<HTMLButtonElement>("button[role=radio]")][1]
    expect(selected, "no Selected projects choice").toBeDefined()
    await act(async () => selected.click())
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

beforeAll(() => loadSubscriptionViews(), 400_000)

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    createConnection.mockReset().mockResolvedValue("claude-1")
    setToken.mockReset().mockResolvedValue(undefined)
    setProjects.mockReset().mockResolvedValue(undefined)
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

describe("opening a subscription view", {timeout: 30_000}, () => {
    it("starts a device login for ChatGPT", async () => {
        await render("chatgpt")
        await waitFor(() => expect(startLogin).toHaveBeenCalledOnce())
    })

    it("starts no device login and creates nothing for Claude", async () => {
        await render("claude")

        expect(startLogin).not.toHaveBeenCalled()
        expect(createConnection).not.toHaveBeenCalled()
        expect(text()).toContain("Paste a token to run agents on your Pro or Max plan.")
        expect(text()).toContain("claude setup-token")
        expect(text()).toContain("You need Claude Code installed.")
    })
})

describe("the token steps", {timeout: 30_000}, () => {
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

        expect(createConnection).toHaveBeenCalledWith({
            provider: "claude",
            name: "Claude",
            scope: "project",
        })
        expect(setToken).toHaveBeenCalledWith({
            secretId: "claude-1",
            token: TOKEN,
            scope: "project",
        })
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
        expect(setToken).toHaveBeenLastCalledWith({
            secretId: "claude-1",
            token: TOKEN,
            scope: "project",
        })
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

        expect(text()).toContain("Agents can run on this subscription.")
        expect(text()).toContain("Ready. Pick a Claude model in any agent.")
        expect(text()).not.toContain("expires")

        await press("Replace token")
        await type(TOKEN)
        await press("Connect")

        expect(createConnection).not.toHaveBeenCalled()
        expect(setToken).toHaveBeenCalledWith({
            secretId: "claude-1",
            token: TOKEN,
            scope: "project",
        })
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

    it("cannot be left while a check is in flight, and goes back once the token is stored", async () => {
        let finish: () => void = () => undefined
        createConnection.mockReturnValue(
            new Promise<string>((resolve) => (finish = () => resolve("claude-1"))),
        )
        await render("claude")
        await type(TOKEN)
        await press("Connect")

        expect(button("Cancel").disabled).toBe(true)
        expect(text()).toContain("Checking…")

        await act(async () => finish())
        expect(setToken).toHaveBeenCalledWith({
            secretId: "claude-1",
            token: TOKEN,
            scope: "project",
        })
        await closed()
    })
})

describe("an organization subscription", {timeout: 30_000}, () => {
    it("shows the API's sentence when the organization already has the provider", async () => {
        const sentence =
            "This organization already has a Claude subscription connection. Remove it before you add another one."
        createConnection.mockRejectedValueOnce(
            Object.assign(new Error("Status code: 409"), {
                statusCode: 409,
                body: {detail: sentence},
            }),
        )
        await render("claude", null, ACME)
        await type(TOKEN)
        await press("Connect")

        expect(createConnection).toHaveBeenCalledWith(
            expect.objectContaining({provider: "claude", scope: "organization"}),
        )
        expect(text()).toContain(sentence)
        expect(text()).not.toContain("Pick another name")
    })

    it("saves its projects without a token", async () => {
        await render("claude", organizationConnection(claudeConnection("pending_login")), ACME)
        await chooseSelectedProjects()
        await press("Done")

        expect(setProjects).toHaveBeenCalledWith({
            connectionId: "claude-1",
            projects: {availability: "selected_projects", projectIds: []},
        })
        expect(setToken).not.toHaveBeenCalled()
        await closed()
    })

    it("stores a typed token, then the projects, with Connect", async () => {
        await render("claude", organizationConnection(claudeConnection("pending_login")), ACME)
        await type(TOKEN)
        await chooseSelectedProjects()
        await press("Connect")

        expect(createConnection).not.toHaveBeenCalled()
        expect(setToken).toHaveBeenCalledWith({
            secretId: "claude-1",
            token: TOKEN,
            scope: "organization",
        })
        expect(setProjects).toHaveBeenCalledWith({
            connectionId: "claude-1",
            projects: {availability: "selected_projects", projectIds: []},
        })
        await closed()
    })

    it("names the plan when the organization may not limit projects", async () => {
        setProjects.mockRejectedValueOnce(
            Object.assign(new Error("Status code: 403"), {
                statusCode: 403,
                body: {
                    detail: {
                        code: "project_limit_not_allowed",
                        message:
                            "Limiting a credential to selected projects is not available for this organization.",
                    },
                },
            }),
        )
        await render("claude", organizationConnection(claudeConnection("pending_login")), ACME)
        await chooseSelectedProjects()
        await press("Done")

        expect(text()).toContain("Choosing projects is available on Business and Enterprise plans.")
        expect(text()).not.toContain("no longer an owner or admin")
        expect(text()).toContain("depth:1")
    })

    it("saves a changed choice at once while a device sign-in waits", async () => {
        const chatgpt = organizationConnection({
            ...claudeConnection("pending_login"),
            id: "chatgpt-1",
            name: "ChatGPT",
            subscription: {provider: "chatgpt", loginState: "pending_login"},
        } as ProviderConnection)
        await render("chatgpt", chatgpt, ACME)
        await waitFor(() => expect(text()).toContain("ABCD-1234"))
        await chooseSelectedProjects()

        await waitFor(() =>
            expect(setProjects).toHaveBeenCalledWith({
                connectionId: "chatgpt-1",
                projects: {availability: "selected_projects", projectIds: []},
            }),
        )
        // The sign-in keeps waiting: the choice did not end it.
        expect(text()).toContain("ABCD-1234")
    })

    it("sends a refused choice once, with no retry", async () => {
        setProjects.mockRejectedValue(new Error("Status code: 500"))
        const chatgpt = organizationConnection({
            ...claudeConnection("pending_login"),
            id: "chatgpt-1",
            name: "ChatGPT",
            subscription: {provider: "chatgpt", loginState: "pending_login"},
        } as ProviderConnection)
        await render("chatgpt", chatgpt, ACME)
        await waitFor(() => expect(text()).toContain("ABCD-1234"))
        await chooseSelectedProjects()
        await waitFor(() => expect(setProjects).toHaveBeenCalledOnce())
        await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
        expect(setProjects).toHaveBeenCalledOnce()
    })
})
