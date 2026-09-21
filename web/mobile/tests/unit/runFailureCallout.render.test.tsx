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
    RETRYABLE_CODES,
    STARTER_CREDIT_CODES,
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

// The route a chat is read on, which is where the workspace and project of the page come from.
vi.mock("next/router", () => import("../support/nextRouter").then((m) => m.nextRouterModule))
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
            <Provider store={createStore()}>
                <TurnRow turn={turn} sessionId="session-1" onRewind={() => undefined} />
            </Provider>,
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
        // "Couldn't start the run" is the card form, which is what a failure with no steps behind
        // it draws; the step form says "The run stopped".
        const shown = renderTurn(failedTurn("model authentication failed"))

        expect(shown).toContain("Couldn't start the run")
        expect(shown).toContain("model authentication failed")
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

    it.each([...STARTER_CREDIT_CODES])(
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
