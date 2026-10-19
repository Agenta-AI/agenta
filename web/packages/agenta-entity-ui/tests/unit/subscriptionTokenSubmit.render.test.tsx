// A stored token through the real atoms: the Fern call, the vault refetch, then the connected view.
import {act, useState} from "react"

import type {ProviderConnection, SecretKind} from "@agenta/entities/secret"
import {projectIdAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {SubscriptionSignInDialog} from "../../src/secretProvider/SubscriptionSignInDialog"

const {client, refetch} = vi.hoisted(() => ({
    client: {setSubscriptionToken: vi.fn()},
    refetch: {current: () => undefined as void},
}))

// By path: this package does not depend on `@agenta/sdk`, the entities package does.
vi.mock("../../../agenta-sdk/src/resources", () => ({getSecretsClient: () => client}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/api")>()),
    getHostQueryClient: () => ({invalidateQueries: async () => refetch.current()}),
}))

const TOKEN = "sk-ant-oat01-abcdef"

const claude = (loginState: string): ProviderConnection => ({
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

/** The vault as the page sees it: the refetch is what turns the row ready. */
const Page = () => {
    const [connection, setConnection] = useState(claude("pending_login"))
    refetch.current = () => setConnection(claude("ready"))
    return (
        <SubscriptionSignInDialog
            open
            onClose={() => undefined}
            provider="claude"
            connection={connection}
        />
    )
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const button = (label: string): HTMLButtonElement =>
    [...document.querySelectorAll("button")].find(
        (item) => item.textContent?.trim() === label,
    ) as HTMLButtonElement

const input = () => document.querySelector("input") as HTMLInputElement

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    client.setSubscriptionToken.mockReset().mockResolvedValue({id: "claude-1"})
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

describe("a stored Claude token", () => {
    it("reaches the API scoped to the project, then shows the connected view with no token kept", async () => {
        const store = createStore()
        store.set(projectIdAtom, "project-1")
        await act(async () => {
            root.render(
                <Provider store={store}>
                    <Page />
                </Provider>,
            )
        })

        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        await act(async () => {
            setter.call(input(), TOKEN)
            input().dispatchEvent(new Event("input", {bubbles: true}))
        })
        await act(async () => button("Connect").click())

        await act(() =>
            vi.waitFor(() => expect(document.body.textContent).not.toContain("Checking…")),
        )
        expect(client.setSubscriptionToken).toHaveBeenCalledWith(
            {secret_id: "claude-1", token: TOKEN},
            {queryParams: {project_id: "project-1"}},
        )
        expect(document.body.textContent).toContain("Ready. Pick a Claude model in any agent.")
        expect(document.body.textContent).not.toContain(TOKEN)

        await act(async () => button("Replace token").click())
        expect(input().value).toBe("")
    })
})
