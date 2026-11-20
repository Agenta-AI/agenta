/**
 * The model providers views (F09 f1 to f3): the list shows only what the project has, the add
 * view replaces itself with the picked provider's form (Save goes back to the list), and the
 * built-in card lists the built-in models with no switches.
 */
import {act, createElement, useEffect, useRef} from "react"

import {
    ViewFormActions,
    ViewStackHost,
    useViewStack,
    type ViewChromeProps,
} from "@agenta/ui/view-stack"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {providerListView} from "../../src/secretProvider/views/providerViews"

import {byText, change, click, findByText, waitFor} from "./domHelpers"

const fixture = vi.hoisted(() => ({
    connections: [] as Record<string, unknown>[],
    saved: [] as string[],
    failSave: false,
    refreshed: 0,
}))

vi.mock("@agenta/entities/secret", async (importOriginal) => {
    const {atom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/secret")>()),
        providerConnectionsAtom: atom(() => fixture.connections),
        refreshVaultSecretsAtom: atom(null, async () => {
            fixture.refreshed += 1
        }),
        vaultSecretsQueryAtom: atom(() => ({
            isPending: false,
            isError: false,
            refetch: () => undefined,
        })),
    }
})

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const {atom} = await import("jotai")
    const candidates = atom(() => ({
        status: "ready",
        candidates: [{namespace: "builtin", harness: "pi_core"}],
        connections: [],
        capabilities: null,
        error: null,
    }))
    return {
        ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
        builtinModelEndpointsQueryAtom: atom(() => ({
            data: [
                {
                    slug: "agenta",
                    models: [
                        "google/gemini-3.8-flash",
                        "google/gemini-4-argon",
                        "google/gemini-3.7-flash",
                    ],
                },
            ],
        })),
        agentModelCandidatesAtomFamily: () => candidates,
        invalidateAgentRequirements: () => undefined,
    }
})

// The connection form is the provider keys milestone's; a key field stands in for it.
vi.mock("../../src/secretProvider/ProviderConnectionCard", () => ({
    default: ({
        kind,
        onSaveStateChange,
        onSaved,
    }: {
        kind: string
        onSaveStateChange: (state: unknown) => void
        onSaved: (id?: string) => void
    }) => {
        // The submit reads the latest callbacks, so the state is published once, not per render.
        const latest = useRef({onSaved, onSaveStateChange})
        latest.current = {onSaved, onSaveStateChange}
        useEffect(() => {
            const publish = (error: string | null) =>
                latest.current.onSaveStateChange({
                    canSave: true,
                    saving: false,
                    error,
                    submit: () => {
                        if (fixture.failSave) return publish("Agenta could not save this.")
                        fixture.saved.push(kind)
                        latest.current.onSaved("new-id")
                    },
                })
            publish(null)
        }, [kind])
        return createElement("input", {"aria-label": `key ${kind}`})
    },
}))

vi.mock("../../src/secretProvider/SubscriptionSignInDialog", () => ({
    default: ({open, provider}: {open: boolean; provider: string}) =>
        open ? createElement("div", null, `sign-in ${provider}`) : null,
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
        <button onClick={() => void stack.open(providerListView, {}, {kind: "project"})}>
            open
        </button>
    )
}

let root: Root
let host: HTMLDivElement
const openList = async () => {
    await act(async () =>
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <Provider store={createStore()}>
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

const connection = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    kind: id.toLowerCase(),
    title: id,
    secretKind: "provider_key",
    hasStoredCredential: true,
    ...extra,
})

// The view bodies load on first open; load them once here so no test waits on the import.
beforeAll(async () => {
    await Promise.all([
        import("../../src/secretProvider/views/ProviderListViewBody"),
        import("../../src/secretProvider/views/ProviderAddViewBody"),
        import("../../src/secretProvider/views/ProviderConnectionViewBody"),
        import("../../src/secretProvider/views/BuiltinModelsViewBody"),
    ])
}, 400_000)

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    fixture.saved = []
    fixture.failSave = false
    fixture.refreshed = 0
    fixture.connections = [
        connection("ChatGPT", {
            kind: "chatgpt",
            subscription: {provider: "chatgpt", loginState: "ready"},
        }),
        connection("Claude", {
            kind: "claude",
            subscription: {provider: "claude", loginState: "expired"},
        }),
        connection("Anthropic"),
        connection("OpenAI"),
        connection("Org key", {scope: "organization"}),
    ]
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("Model providers list", {timeout: 30_000}, () => {
    it("shows Agenta, the subscriptions and the API keys, with a state only where needed", async () => {
        await openList()
        const text = document.body.textContent ?? ""
        for (const part of ["Agenta", "Built-in", "Subscriptions", "API keys", "Anthropic"]) {
            expect(text).toContain(part)
        }
        // The Claude sign-in expired: it says so and offers a new sign-in instead of Edit.
        expect(byText("Sign in needed")).toBeTruthy()
        expect(byText("Sign in again")).toBeTruthy()
        expect(text).not.toContain("Connected")
        // The organization's connection is not the project's to edit here.
        expect(text).not.toContain("Org key")
        expect(byText("Add a provider or subscription")).toBeTruthy()
    })

    it("a picked provider replaces the add view; Save goes back to the list", async () => {
        await openList()
        await click(byText("Add a provider or subscription"))
        await findByText("here:Add")
        const text = document.body.textContent ?? ""
        expect(text.indexOf("ChatGPT")).toBeLessThan(text.indexOf("Mistral AI"))
        expect(text).toContain("OpenAI-compatible endpoint")
        expect(text).toContain("Self-hosted or proxied models that speak the OpenAI API")

        await click(byText("OpenAI", "button span"))
        await findByText("here:OpenAI")
        // The form took the add view's place: the crumb goes Agent › Model providers › OpenAI.
        expect(byText("crumb:Model providers")).toBeTruthy()
        expect(byText("here:Add")).toBeUndefined()
        await change(await findByText("", 'input[aria-label="key openai"]'), "sk-test")
        await click(byText("Save connection"))
        await findByText("here:Model providers")
        expect(fixture.saved).toEqual(["openai"])
        // The list and the picker read the vault, so the save refreshes it.
        expect(fixture.refreshed).toBe(1)
    })

    it("a failed save keeps the form open", async () => {
        fixture.failSave = true
        await openList()
        await click(byText("Add a provider or subscription"))
        await findByText("here:Add")
        await click(byText("OpenAI", "button span"))
        await change(await findByText("", 'input[aria-label="key openai"]'), "sk-test")
        await click(byText("Save connection"))
        await waitFor(() => expect(byText("here:OpenAI")).toBeTruthy())
        expect(byText("here:Model providers")).toBeUndefined()
        expect(fixture.saved).toEqual([])
    })

    it("search with no match shows the production text", async () => {
        await openList()
        await click(byText("Add a provider or subscription"))
        const search = await findByText("", 'input[placeholder="Search providers"]')
        await change(search, "zzz")
        await findByText("No provider matches this search.")
    })

    it("a subscription row opens its sign-in", async () => {
        await openList()
        await click(byText("Sign in again"))
        await findByText("sign-in claude")
    })

    it("the Agenta card lists every built-in model, with no switches and Done only", async () => {
        await openList()
        await click(document.querySelector("li button"))
        await findByText("here:Agenta")
        for (const model of [
            "google/gemini-3.8-flash",
            "google/gemini-4-argon",
            "google/gemini-3.7-flash",
        ]) {
            expect(document.body.textContent).toContain(model)
        }
        expect(byText("Provided by Agenta")).toBeTruthy()
        expect(document.querySelector('[role="checkbox"], input[type="checkbox"]')).toBeNull()
        expect(byText("Save")).toBeUndefined()
        await click(byText("Done"))
        await waitFor(() => expect(byText("here:Model providers")).toBeTruthy())
    })
})
