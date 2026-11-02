// @vitest-environment jsdom
// A failed mobile turn: the server's text as the message, one way out, and retry where it helps.
import {act} from "react"

import {
    NOT_SENT_CODES,
    OWN_KEY_CODES,
    PLAN_LIMIT_TITLES,
    RETRYABLE_CODES,
    SUBSCRIPTION_LOGIN_CODES,
} from "@agenta/chat/components"
import {buildTurnViewModels, createExecutedToolIdentityCache} from "@agenta/chat/model"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {TurnRow} from "@/features/chat/TurnRow"

import {routerPush, routerQuery} from "../support/nextRouter"
import {WithQueryClient} from "../support/queryClient"

vi.mock("next/router", () => import("../support/nextRouter").then((m) => m.nextRouterModule))

const topUpOffer = vi.hoisted(() => ({status: "unavailable" as string, calls: [] as unknown[]}))
// Checkout needs `edit_billing`; the check itself is covered by its own suite.
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: () => true,
    useProjectPermissionState: () => ({allowed: true, pending: false}),
}))
vi.mock("@agenta/settings-ui", () => ({
    useTopUpOffer: (params: {enabled?: boolean}) => {
        topUpOffer.calls.push(params)
        return {data: params.enabled ? {status: topUpOffer.status, packs: []} : undefined}
    },
}))

// The in-place surfaces, reduced to a marker that says which one opened.
vi.mock("@/features/chat/RunErrorProviderDrawer", () => ({
    RunErrorProviderDrawer: ({open, providerKind}: {open: boolean; providerKind?: string}) =>
        open ? <div>[providers drawer: {providerKind ?? "catalog"}]</div> : null,
}))
vi.mock("@/features/chat/RunErrorBuyCreditsDialog", () => ({
    RunErrorBuyCreditsDialog: ({open}: {open: boolean}) =>
        open ? <div>[buy credits dialog]</div> : null,
}))
vi.mock("@/features/chat/RunErrorPlansDialog", () => ({
    RunErrorPlansDialog: ({open}: {open: boolean}) => (open ? <div>[plans dialog]</div> : null),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const runtime = globalThis as typeof globalThis & {__env?: Record<string, string>}
let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    host = undefined
    routerPush.mockClear()
    delete runtime.__env
    topUpOffer.status = "unavailable"
    topUpOffer.calls = []
})

const failedTurn = (message: string, code?: string): UIMessage =>
    ({
        id: "turn-1",
        role: "assistant",
        parts: [],
        metadata: {runError: {message, ...(code ? {code} : {})}},
    }) as unknown as UIMessage

const transportFailure = (): UIMessage =>
    ({
        id: "turn-1",
        role: "assistant",
        parts: [],
        metadata: {runError: {message: "Network request failed.", transport: true}},
    }) as unknown as UIMessage

/** Rendered as the last turn, which is the only turn this app offers a retry on. */
const renderTurn = (message: UIMessage): string => {
    const [turn] = buildTurnViewModels([message], {
        busy: false,
        executedFor: createExecutedToolIdentityCache(),
    })
    host = document.createElement("div")
    root = createRoot(host)
    act(() => {
        root!.render(
            <WithQueryClient>
                <Provider store={createStore()}>
                    <TurnRow turn={turn} sessionId="session-1" onRewind={() => undefined} />
                </Provider>
            </WithQueryClient>,
        )
    })
    return shown()
}

const shown = () => (host?.textContent ?? "").replace(/\s+/g, " ").trim()
const hasRetry = () => !!host?.querySelector('button[aria-label="Try again"]')

const press = (label: string) => {
    const target = [...(host?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent?.trim() === label,
    )
    expect(target, `no button labelled "${label}"`).toBeTruthy()
    act(() => target!.click())
}

const billingOn = () => {
    runtime.__env = {NEXT_PUBLIC_AGENTA_BILLING_ENABLED: "true"}
}

describe("mobile TurnRow: a run that failed", () => {
    it("names the failure in the fold and shows the server's text as the message", () => {
        const text = renderTurn(failedTurn("model authentication failed"))

        expect(text).toContain("Run stopped")
        expect(text).toContain("model authentication failed")
        expect(text).not.toContain("The agent run failed")
    })

    it("offers no retry for a refusal nothing but a new request would fix", () => {
        renderTurn(failedTurn("model authentication failed"))
        expect(hasRetry()).toBe(false)
    })

    it("shows a provider's own error whole, with no retry", () => {
        const text =
            "The model provider (Inception) returned an error: I'm sorry, but I can't share details of my architecture or training process. You can keep going in this conversation."
        const rendered = renderTurn(failedTurn(text, "provider_error"))

        expect(rendered).toContain("I'm sorry, but I can't share details of my architecture")
        expect(rendered).toContain("You can keep going in this conversation.")
        expect(hasRetry()).toBe(false)
    })

    it.each([...RETRYABLE_CODES])("offers Try again for %s", (code) => {
        renderTurn(failedTurn("Try that again.", code))
        expect(hasRetry()).toBe(true)
    })

    it("offers Try again for a request that never reached Agenta", () => {
        renderTurn(transportFailure())
        expect(hasRetry()).toBe(true)
    })

    it.each([...NOT_SENT_CODES])("says the message was not sent, with no retry, for %s", (code) => {
        const text = renderTurn(failedTurn("That session is busy.", code))

        expect(text).toContain("Message not sent")
        expect(hasRetry()).toBe(false)
    })

    it.each([...OWN_KEY_CODES])("opens the providers drawer in place for %s", (code) => {
        const text = renderTurn(failedTurn("Out of starter credits.", code))

        expect(text).toContain("Out of starter credits.")
        expect(hasRetry()).toBe(true)
        press("Add key")
        expect(shown()).toContain("[providers drawer: catalog]")
        expect(routerPush).not.toHaveBeenCalled()
    })

    it("offers credits and a key when free credits run out and packs can be bought", () => {
        billingOn()
        topUpOffer.status = "available"
        const text = renderTurn(
            failedTurn(
                "Your free Agenta credits are used up. Add your own provider key to keep going.",
                "starter_credits_exhausted",
            ),
        )

        expect(text).toContain("Your free Agenta credits are used up.")
        expect(text).toContain("Buy more credits, or add your own provider key to keep going.")
        expect(text).toContain("Buy credits")
        expect(text).toContain("Add key")
        press("Buy credits")
        expect(shown()).toContain("[buy credits dialog]")
    })

    it.each([...SUBSCRIPTION_LOGIN_CODES])("routes to AI providers to reconnect for %s", (code) => {
        renderTurn(failedTurn("Your Claude sign-in expired.", code))

        press("Open AI providers")
        expect(routerPush).toHaveBeenCalledWith("/w/ws-1/p/proj-1/settings?tab=llms")
    })

    describe("a plan limit", () => {
        const sentence =
            "Your Hobby plan allows 2 agents at a time, and 2 are running. We didn't start this request or charge you. Resend when one finishes, or upgrade to Pro for 10 at a time."

        it.each(Object.entries(PLAN_LIMIT_TITLES))(
            "%s shows its title and the platform's whole sentence, with a retry",
            (code, title) => {
                const text = renderTurn(failedTurn(sentence, code))

                expect(text).toContain(title)
                expect(text).toContain("We didn't start this request or charge you.")
                expect(text).not.toContain(code)
                expect(hasRetry()).toBe(true)
            },
        )

        it("opens the plans in place where billing is on", () => {
            billingOn()
            renderTurn(failedTurn(sentence, "concurrent_turns_limit"))

            press("See plans")
            expect(shown()).toContain("[plans dialog]")
        })

        it("draws no plans card where billing is off", () => {
            expect(renderTurn(failedTurn(sentence, "turn_time_limit_reached"))).not.toContain(
                "See plans",
            )
        })

        it("offers only Buy credits where the organization can buy a pack", () => {
            billingOn()
            topUpOffer.status = "available"
            const text = renderTurn(failedTurn(sentence, "wallet_balance_exhausted"))

            expect(text).toContain("Buy credits")
            expect(text).not.toContain("See plans")
        })

        it("offers only the plans where the organization cannot buy a pack", () => {
            billingOn()
            topUpOffer.status = "paid_plan_required"
            const text = renderTurn(failedTurn(sentence, "wallet_balance_exhausted"))

            expect(text).toContain("See plans")
            expect(text).not.toContain("Buy credits")
        })

        it("does not ask about packs for a limit credits do not clear", () => {
            billingOn()
            topUpOffer.status = "available"
            renderTurn(failedTurn(sentence, "concurrent_turns_limit"))

            expect(topUpOffer.calls.every((call) => !(call as {enabled: boolean}).enabled)).toBe(
                true,
            )
        })
    })

    it("shows included models being off as its own refusal, with the key card", () => {
        const sentence =
            "Agenta's included models aren't enabled for your organization. Use your own provider key, or contact us."
        const text = renderTurn(failedTurn(sentence, "builtin_models_not_enabled"))

        expect(text).toContain("This model isn't available for your organization")
        expect(text).toContain("Agenta's included models aren't enabled for your organization.")
        expect(text).toContain("Add key")
        expect(text).not.toContain("builtin_models_not_enabled")
    })

    it("links to the provider's billing page when the reader's own key is out of credits", () => {
        renderTurn(
            failedTurn(
                '402: {"message":"This request requires more credits. To increase, visit https://openrouter.ai/settings/credits","code":402}',
                "upstream_rejected",
            ),
        )

        const link = host?.querySelector("a")
        expect(link?.textContent).toContain("Open OpenRouter")
        expect(link?.getAttribute("href")).toBe("https://openrouter.ai/settings/credits")
        expect(link?.getAttribute("target")).toBe("_blank")
        expect(hasRetry()).toBe(true)
    })

    it("opens the failed provider's card when its key was rejected", () => {
        renderTurn(
            failedTurn(
                '401: {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}} anthropic',
                "upstream_rejected",
            ),
        )

        press("Update key")
        expect(shown()).toContain("[providers drawer: anthropic]")
    })

    it("never shows the gateway's code marker", () => {
        const text = renderTurn(
            failedTurn(
                "The model provider refused the request (HTTP 403): Denied use_llm_endpoints on builtin/agenta ⟦agenta_code:policy_denied⟧",
                "provider_error",
            ),
        )

        expect(text).toContain("Denied use_llm_endpoints on builtin/agenta")
        expect(text).not.toContain("agenta_code")
    })

    it("draws no card off a project route, where nothing can open", () => {
        delete routerQuery.project_id
        try {
            const text = renderTurn(
                failedTurn("Out of starter credits.", "starter_credits_exhausted"),
            )

            expect(text).toContain("Out of starter credits.")
            expect(text).not.toContain("Add key")
        } finally {
            routerQuery.project_id = "proj-1"
        }
    })
})
