// @vitest-environment jsdom
//
// The mobile turn's wiring into its run-failure callout.
//
// The callout is this app's own again: it draws a failure as a step on the activity timeline, or
// as a card when the run never started, which the shared one has no form for. What it does NOT
// decide for itself is WHICH failure class gets which action — those sets live in
// `@agenta/chat/components` beside the desktop's callout, and this suite reads them from there so
// a class added in one app cannot go unanswered in the other.
//
// What is pinned here is this app's half: a failed turn renders it with the run's reason, and each
// failure class draws the escape that clears it. Which classes those are is the package's rule,
// held in one place for both apps; this app's job is to pass the escapes at all.
//
// It had drawn neither of those two, on the grounds that this app has no provider drawer. It does
// have the destination: Settings -> LLM providers renders the same shared AI-providers page the
// desktop drawer opens. Until it was wired, an exhausted starter grant and a dead subscription
// sign-in each left a phone reader with a red bubble and nothing to press.
import {act} from "react"

import {
    OWN_KEY_CODES,
    PLAN_LIMIT_TITLES,
    RETRYABLE_CODES,
    SUBSCRIPTION_LOGIN_CODES,
} from "@agenta/chat/components"
import {
    buildTurnViewModels,
    createExecutedToolIdentityCache,
    SESSION_TURN_IN_USE_CODE,
} from "@agenta/chat/model"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {TurnRow} from "@/features/chat/TurnRow"

import {routerPush, routerQuery} from "../support/nextRouter"
import {WithQueryClient} from "../support/queryClient"

// The route a chat is read on, which is where the workspace and project of the page come from.
vi.mock("next/router", () => import("../support/nextRouter").then((m) => m.nextRouterModule))

// Whether the organization can buy a credit pack, which the API answers.
const topUpOffer = vi.hoisted(() => ({status: "unavailable" as string, calls: [] as unknown[]}))
vi.mock("@agenta/settings-ui", () => ({
    useTopUpOffer: (params: {enabled?: boolean}) => {
        topUpOffer.calls.push(params)
        return {data: params.enabled ? {status: topUpOffer.status, packs: []} : undefined}
    },
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    host = undefined
    routerPush.mockClear()
})

const failedTurn = (message: string, code?: string): UIMessage =>
    ({
        id: "turn-1",
        role: "assistant",
        parts: [],
        metadata: {runError: {message, ...(code ? {code} : {})}},
    }) as unknown as UIMessage

/** A request that never reached Agenta, which carries no failure class of its own. */
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
    return (host.textContent ?? "").replace(/\s+/g, " ").trim()
}

const press = (label: string) => {
    const target = [...(host?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent?.trim() === label,
    )
    expect(target, `no button labelled "${label}"`).toBeTruthy()
    act(() => target!.click())
}

describe("mobile TurnRow: a run that failed", () => {
    it("renders the callout with the run's own reason", () => {
        // The card form, drawn for a failure with no steps behind it, says what the step form
        // says. It used to say "Couldn't start the run", which was wrong for a run that started
        // and was refused by the model on its first request.
        const shown = renderTurn(failedTurn("model authentication failed"))

        expect(shown).toContain("The run stopped")
        expect(shown).not.toContain("Couldn't start the run")
        expect(shown).toContain("model authentication failed")
    })

    it("shows a provider's own error whole, with no Try again", () => {
        const text =
            "The model provider (Inception) returned an error: I'm sorry, but I can't share details of my architecture or training process. You can keep going in this conversation."
        const shown = renderTurn(failedTurn(text, "provider_error"))

        expect(shown).toContain("I'm sorry, but I can't share details of my architecture")
        expect(shown).toContain("You can keep going in this conversation.")
        expect(shown).not.toContain("Try again")
    })

    it.each([...RETRYABLE_CODES])("offers Try again for %s", (code) => {
        // Every class the shared component calls transient, read from the component's own set, so
        // a class added there fails here until this app offers its action too. This app narrowed
        // the retry to `continuation_resumed` alone on top of that set, so five of these drew a
        // button on the desktop and none on a phone.
        expect(renderTurn(failedTurn("Try that again.", code))).toContain("Try again")
    })

    it("offers Try again for a request that never reached Agenta", () => {
        // A transport failure carries no code at all; position is the only thing to gate on.
        expect(renderTurn(transportFailure())).toContain("Try again")
    })

    it("offers no retry on a failure class nothing but a new request would fix", () => {
        // The package decides this, and it still decides it: a model refusal is not transient.
        expect(renderTurn(failedTurn("model authentication failed"))).not.toContain("Try again")
    })

    it("says the message was not sent, with no retry, when the session refused it", () => {
        // An admission refusal is not a run that failed, and replaying it would refuse again.
        const shown = renderTurn(failedTurn("That session is busy.", SESSION_TURN_IN_USE_CODE))

        expect(shown).toContain("Message not sent")
        expect(shown).not.toContain("The agent run failed")
        expect(shown).not.toContain("Try again")
    })

    it.each([...OWN_KEY_CODES])(
        "offers the key escape for %s, and takes the reader there",
        (code) => {
            const shown = renderTurn(failedTurn("Out of starter credits.", code))

            expect(shown).toContain("Out of starter credits.")
            expect(shown).toContain("Add your key")

            press("Add your key")

            expect(routerPush).toHaveBeenCalledWith("/w/ws-1/p/proj-1/settings?tab=llms")
        },
    )

    it.each([...SUBSCRIPTION_LOGIN_CODES])("offers the sign-in escape for %s", (code) => {
        // A dead subscription sign-in is not fixed by a key, but it is fixed on the same page: the
        // AI providers page is where a new device login happens. One destination, as on the desktop.
        const shown = renderTurn(failedTurn("Your Claude sign-in expired.", code))

        expect(shown).toContain("Sign in again")
        expect(shown).not.toContain("Add your key")

        press("Sign in again")

        expect(routerPush).toHaveBeenCalledWith("/w/ws-1/p/proj-1/settings?tab=llms")
    })

    describe("a plan limit", () => {
        const runtime = globalThis as typeof globalThis & {__env?: Record<string, string>}
        afterEach(() => {
            delete runtime.__env
        })
        const sentence =
            "Your Hobby plan allows 2 agents at a time, and 2 are running. We didn't start this request or charge you. Resend when one finishes, or upgrade to Pro for 10 at a time."

        it.each(Object.entries(PLAN_LIMIT_TITLES))(
            "%s shows its title and the platform's whole sentence, never the code",
            (code, title) => {
                const shown = renderTurn(failedTurn(sentence, code))

                expect(shown).toContain(title)
                expect(shown).toContain(sentence)
                expect(shown).not.toContain(code)
                expect(shown).not.toContain("The run stopped")
                expect(shown).not.toContain("Try again")
            },
        )

        it("offers the plans where billing is on, and takes the reader there", () => {
            runtime.__env = {NEXT_PUBLIC_AGENTA_BILLING_ENABLED: "true"}
            renderTurn(failedTurn(sentence, "concurrent_turns_limit"))

            press("Plans and billing")

            expect(routerPush).toHaveBeenCalledWith("/w/ws-1/p/proj-1/settings?tab=billing")
        })

        it("draws no plans button where billing is off", () => {
            expect(renderTurn(failedTurn(sentence, "turn_time_limit_reached"))).not.toContain(
                "Plans and billing",
            )
        })

        describe("out of credits", () => {
            afterEach(() => {
                topUpOffer.status = "unavailable"
                topUpOffer.calls = []
            })

            it("offers Buy credits where the organization can buy a pack, and opens the picker", () => {
                runtime.__env = {NEXT_PUBLIC_AGENTA_BILLING_ENABLED: "true"}
                topUpOffer.status = "available"
                const shown = renderTurn(failedTurn(sentence, "wallet_balance_exhausted"))

                expect(shown).toContain("Buy credits")
                expect(shown).toContain("Plans and billing")
                press("Buy credits")
                expect(routerPush).toHaveBeenCalledWith(
                    "/w/ws-1/p/proj-1/settings?tab=credits&buy_credits=1",
                )
            })

            it("keeps only the plans on the free plan, which cannot buy a pack", () => {
                runtime.__env = {NEXT_PUBLIC_AGENTA_BILLING_ENABLED: "true"}
                topUpOffer.status = "paid_plan_required"
                const shown = renderTurn(failedTurn(sentence, "wallet_balance_exhausted"))

                expect(shown).toContain("Plans and billing")
                expect(shown).not.toContain("Buy credits")
            })

            it("changes nothing where the wallet is off or in shadow", () => {
                runtime.__env = {NEXT_PUBLIC_AGENTA_BILLING_ENABLED: "true"}
                topUpOffer.status = "unavailable"
                const shown = renderTurn(failedTurn(sentence, "wallet_balance_exhausted"))

                expect(shown).not.toContain("Buy credits")
            })

            it("does not ask about packs for a limit credits do not clear", () => {
                runtime.__env = {NEXT_PUBLIC_AGENTA_BILLING_ENABLED: "true"}
                topUpOffer.status = "available"
                const shown = renderTurn(failedTurn(sentence, "concurrent_turns_limit"))

                expect(shown).not.toContain("Buy credits")
                expect(
                    topUpOffer.calls.every((call) => !(call as {enabled: boolean}).enabled),
                ).toBe(true)
            })
        })
    })

    it("shows included models being off as its own refusal, with the key escape", () => {
        const sentence =
            "Agenta's included models aren't enabled for your organization. Use your own provider key, or contact us."
        const shown = renderTurn(failedTurn(sentence, "builtin_models_not_enabled"))

        expect(shown).toContain("This model isn't available for your organization")
        expect(shown).toContain(sentence)
        expect(shown).toContain("Add your key")
        expect(shown).not.toContain("builtin_models_not_enabled")
        expect(shown).not.toContain("Plans and billing")
    })

    it("never shows the gateway's code marker", () => {
        // Release QA, 2026-10-03: the reason read "... ⟦agenta_code:policy_denied⟧".
        const shown = renderTurn(
            failedTurn(
                "The model provider refused the request (HTTP 403): Denied use_llm_endpoints on builtin/agenta \u27e6agenta_code:policy_denied\u27e7",
                "provider_error",
            ),
        )

        expect(shown).toContain("Denied use_llm_endpoints on builtin/agenta")
        expect(shown).not.toContain("agenta_code")
    })

    it("draws no escape off a project route, where there is no page to send anyone to", () => {
        delete routerQuery.project_id
        try {
            const shown = renderTurn(
                failedTurn("Out of starter credits.", "starter_credits_exhausted"),
            )

            expect(shown).toContain("Out of starter credits.")
            expect(shown).not.toContain("Add your key")
        } finally {
            routerQuery.project_id = "proj-1"
        }
    })
})
