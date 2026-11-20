/**
 * The subscription views (F11 f8 to f10): ChatGPT's device code and Claude's token, opened from
 * "Add a provider or subscription" and from the list. The device code poll stops when the view
 * closes.
 */
import {act} from "react"

import {
    ViewFormActions,
    ViewStackHost,
    useViewStack,
    type ViewChromeProps,
} from "@agenta/ui/view-stack"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider, type Atom, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {setupTokenOf} from "../../src/secretProvider/useSubscriptionToken"
import {providerListView} from "../../src/secretProvider/views/providerViews"

import {byText, change, click, findByText, keyDown, waitFor} from "./domHelpers"

const fx = vi.hoisted(() => ({
    atoms: {} as {
        connections: PrimitiveAtom<Record<string, unknown>[]>
        attemptState: PrimitiveAtom<string>
    },
    /** Poll keys whose query is mounted right now. */
    polling: new Set<string>(),
    started: 0,
    cancelled: [] as string[],
    tokens: [] as string[],
}))

vi.mock("@agenta/entities/secret", async (importOriginal) => {
    const {atom} = await import("jotai")
    const connections = atom<Record<string, unknown>[]>([])
    const attemptState = atom("pending")
    fx.atoms = {connections, attemptState}
    const attempts = new Map<string, Atom<unknown>>()
    const ready = (provider: string) => (list: Record<string, unknown>[]) =>
        list.map((item) =>
            (item.subscription as {provider?: string} | undefined)?.provider === provider
                ? {...item, subscription: {provider, loginState: "ready"}}
                : item,
        )
    return {
        ...(await importOriginal<typeof import("@agenta/entities/secret")>()),
        providerConnectionsAtom: atom((get) => get(connections)),
        vaultSecretsQueryAtom: atom(() => ({
            isPending: false,
            isError: false,
            refetch: () => undefined,
        })),
        createSubscriptionConnectionAtom: atom(
            null,
            async (get, set, {provider}: {provider: string}) => {
                set(connections, [
                    ...get(connections),
                    {
                        id: `${provider}-1`,
                        name: provider === "chatgpt" ? "ChatGPT" : "Claude",
                        kind: provider === "chatgpt" ? "openai" : "anthropic",
                        title: provider,
                        secretKind: "subscription_provider",
                        subscription: {provider, loginState: "pending_login"},
                    },
                ])
                return `${provider}-1`
            },
        ),
        startSubscriptionLoginAtom: atom(null, async () => {
            fx.started += 1
            return {
                attempt_id: `attempt-${fx.started}`,
                user_code: "KXRT-9P4M",
                verification_uri: "https://auth.openai.com/codex/device",
                expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
            }
        }),
        cancelSubscriptionLoginAtom: atom(null, async (_get, _set, {attemptId}) => {
            fx.cancelled.push(attemptId as string)
        }),
        forgetLoginAttemptAtom: atom(null, () => undefined),
        // The poll: mounted while a view reads it, and the test moves its state.
        loginAttemptQueryAtomFamily: (key: string) => {
            if (!attempts.has(key)) {
                // Writable, because jotai calls `onMount` only on writable atoms.
                const query = atom(
                    (get) => ({data: key ? {state: get(attemptState)} : null, error: null}),
                    () => undefined,
                )
                query.onMount = () => {
                    if (key) fx.polling.add(key)
                    return () => fx.polling.delete(key)
                }
                attempts.set(key, query)
            }
            return attempts.get(key)
        },
        // The refetch after a sign-in or a stored token reads the subscription as ready.
        refreshVaultSecretsAtom: atom(null, async (get, set) => {
            if (get(attemptState) === "succeeded") {
                set(connections, ready("chatgpt")(get(connections)))
            }
        }),
        setSubscriptionTokenAtom: atom(null, async (get, set, {token}: {token: string}) => {
            fx.tokens.push(token)
            set(connections, ready("claude")(get(connections)))
        }),
    }
})

vi.mock("@agenta/entities/workflow", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
    builtinModelEndpointsQueryAtom: (await import("jotai")).atom(() => ({data: []})),
    invalidateAgentRequirements: () => undefined,
}))

const Chrome = ({crumbs, children, ...actions}: ViewChromeProps) => (
    <div>
        <nav>
            {crumbs.map((crumb, i) =>
                crumb.onSelect ? (
                    <button key={i} onClick={crumb.onSelect}>{`crumb:${crumb.title}`}</button>
                ) : (
                    <span key={i}>{`here:${crumb.title}`}</span>
                ),
            )}
        </nav>
        {children}
        <ViewFormActions {...actions} />
    </div>
)

const Opener = () => {
    const stack = useViewStack()
    return (
        <>
            <button onClick={() => void stack.open(providerListView, {}, {kind: "project"})}>
                open
            </button>
            <button onClick={() => void stack.closeAll()}>close all</button>
        </>
    )
}

let root: Root
let host: HTMLDivElement
let store: ReturnType<typeof createStore>

const openList = async () => {
    await act(async () =>
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <Provider store={store}>
                    <ViewStackHost chrome={Chrome} rootTitle="Agent">
                        <Opener />
                    </ViewStackHost>
                </Provider>
            </QueryClientProvider>,
        ),
    )
    await click(byText("open"))
    await findByText("here:Model providers")
}

const pick = async (name: string) => {
    await click(byText("Add a provider or subscription"))
    await findByText("here:Add")
    await click(byText(name, "button span"))
    await findByText(`here:${name}`)
}

const button = (label: string) =>
    [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)

beforeAll(async () => {
    await Promise.all([
        import("../../src/secretProvider/views/ProviderListViewBody"),
        import("../../src/secretProvider/views/ProviderAddViewBody"),
        import("../../src/secretProvider/views/SubscriptionSignInViewBody"),
        import("../../src/secretProvider/views/SubscriptionTokenViewBody"),
    ])
}, 400_000)

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {writeText: async () => undefined},
    })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    store = createStore()
    store.set(fx.atoms.connections, [])
    store.set(fx.atoms.attemptState, "pending")
    fx.polling.clear()
    fx.started = 0
    fx.cancelled = []
    fx.tokens = []
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("the setup token rule", () => {
    it("takes only a token that starts with sk-ant-oat", () => {
        expect(setupTokenOf("sk-ant-oat01-abc")).toBe("sk-ant-oat01-abc")
        expect(setupTokenOf("sk-ant-api03-abc")).toBeNull()
        expect(setupTokenOf("abc")).toBeNull()
        expect(setupTokenOf("")).toBeNull()
        // A wrapped terminal line adds spaces and line breaks; they are not part of the token.
        expect(setupTokenOf("  sk-ant-oat01-\n abc ")).toBe("sk-ant-oat01-abc")
    })
})

describe("ChatGPT device code view", {timeout: 30_000}, () => {
    it("shows the code; after Copy it says Copied and waits; the sign-in returns to the list", async () => {
        await openList()
        await pick("ChatGPT")
        await findByText("KXRT-9P4M")
        const text = document.body.textContent ?? ""
        for (const part of [
            "Waiting for you to sign in",
            "Open ChatGPT and enter this code. Keep this page open.",
            "Open ChatGPT",
            "Expires in",
            "Cancel",
        ]) {
            expect(text).toContain(part)
        }
        expect(text).not.toContain("Waiting for ChatGPT to confirm")
        expect(fx.polling.size).toBe(1)

        await click(button("Copy"))
        await findByText("Copied")
        expect(document.body.textContent).toContain("Waiting for ChatGPT to confirm")

        await act(async () => store.set(fx.atoms.attemptState, "succeeded"))
        await findByText("here:Model providers")
        expect(byText("ChatGPT", "li span")).toBeTruthy()
        expect(fx.polling.size).toBe(0)
    })

    it("Cancel ends the sign-in, stops the poll and returns to the list", async () => {
        await openList()
        await pick("ChatGPT")
        await findByText("KXRT-9P4M")
        await click(button("Cancel"))
        await findByText("here:Model providers")
        await waitFor(() => expect(fx.cancelled).toEqual(["attempt-1"]))
        expect(fx.polling.size).toBe(0)
    })

    it("closing the container stops the poll", async () => {
        await openList()
        await pick("ChatGPT")
        await findByText("KXRT-9P4M")
        expect(fx.polling.size).toBe(1)
        await click(byText("close all"))
        await waitFor(() => expect(byText("here:ChatGPT")).toBeUndefined())
        await waitFor(() => expect(fx.cancelled).toEqual(["attempt-1"]))
        expect(fx.polling.size).toBe(0)
    })

    it("an expired code says so in a red line", async () => {
        await openList()
        await pick("ChatGPT")
        await findByText("KXRT-9P4M")
        await act(async () => store.set(fx.atoms.attemptState, "expired"))
        await findByText("The sign-in code expired. Start again.", "p")
        expect(byText("Connect ChatGPT")).toBeTruthy()
        expect(fx.polling.size).toBe(0)
    })

    it("Sign in again on the list row starts a sign-in on that connection", async () => {
        store.set(fx.atoms.connections, [
            {
                id: "chatgpt-1",
                name: "ChatGPT",
                kind: "openai",
                title: "ChatGPT",
                secretKind: "subscription_provider",
                subscription: {provider: "chatgpt", loginState: "needs_login"},
            },
        ])
        await openList()
        await click(button("Sign in again"))
        await findByText("here:ChatGPT")
        await findByText("KXRT-9P4M")
        // From the list, Cancel goes back to the list.
        await click(button("Cancel"))
        await findByText("here:Model providers")
        expect(fx.polling.size).toBe(0)
    })
})

describe("ChatGPT view on a ready connection", {timeout: 30_000}, () => {
    const ready = {
        id: "chatgpt-1",
        name: "ChatGPT",
        kind: "openai",
        title: "ChatGPT",
        secretKind: "subscription_provider",
        subscription: {provider: "chatgpt", loginState: "ready"},
    }

    it("opens to its status and starts nothing", async () => {
        store.set(fx.atoms.connections, [ready])
        await openList()
        await click(button("Edit"))
        await findByText("here:ChatGPT")
        await findByText("Ready. Pick a ChatGPT model in any agent.")
        expect(fx.started).toBe(0)
    })

    it("a failed new sign-in stays on the view with its error", async () => {
        store.set(fx.atoms.connections, [ready])
        await openList()
        await click(button("Edit"))
        await findByText("here:ChatGPT")
        await click(button("Sign in again"))
        await findByText("KXRT-9P4M")
        await act(async () => store.set(fx.atoms.attemptState, "expired"))
        await findByText("The sign-in code expired. Start again.", "p")
        expect(byText("here:ChatGPT")).toBeTruthy()
    })
})

describe("Claude token view", {timeout: 30_000}, () => {
    it("Connect is on only for a setup token; a stored token returns to the list", async () => {
        await openList()
        await pick("Claude")
        const text = document.body.textContent ?? ""
        for (const part of [
            "Paste a token to run agents on your Pro or Max plan.",
            "Run this command on your computer",
            "claude setup-token",
            "Sign in to Claude",
            "Paste the token the command prints",
        ]) {
            expect(text).toContain(part)
        }
        const field = document.querySelector('input[type="password"]') as HTMLInputElement
        expect(button("Connect")?.disabled).toBe(true)
        await change(field, "sk-ant-api03-abc")
        expect(button("Connect")?.disabled).toBe(true)
        await change(field, "sk-ant-oat01-abc")
        await waitFor(() => expect(button("Connect")?.disabled).toBe(false))
        // Enter stores nothing: Save of the stack is the one save path.
        await keyDown(field, "Enter")
        expect(fx.tokens).toEqual([])
        await click(button("Connect"))
        await findByText("here:Model providers")
        expect(fx.tokens).toEqual(["sk-ant-oat01-abc"])
        expect(byText("Claude", "li span")).toBeTruthy()
    })
})
