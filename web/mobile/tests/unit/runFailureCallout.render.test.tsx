// @vitest-environment jsdom
//
// The mobile turn's wiring into the shared run-failure callout.
//
// This app drew its own callout, a private `RunErrorCallout` that reimplemented the desktop's
// rather than copying it: its own clamp threshold, its own toggle wording, its own retry rule, and
// no test. Both apps render the package's component now.
//
// What is pinned here is this app's half: a failed turn renders it with the run's reason, the
// retry is offered for the one class this app passes a retry for, and each failure class the
// reader can clear with a credential draws the escape that clears it.
//
// It had drawn neither of those two, on the grounds that this app has no provider drawer. It does
// have the destination: Settings -> LLM providers renders the same shared AI-providers page the
// desktop drawer opens. Until it was wired, an exhausted starter grant and a dead subscription
// sign-in each left a phone reader with a red bubble and nothing to press.
import {act} from "react"

import {buildTurnViewModels, createExecutedToolIdentityCache} from "@agenta/chat/model"
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
    it("renders the shared callout with the run's own reason", () => {
        const shown = renderTurn(failedTurn("model authentication failed"))

        expect(shown).toContain("The agent run failed")
        expect(shown).toContain("model authentication failed")
    })

    it("offers Try again for the continuation race, which is the class it passes a retry for", () => {
        expect(
            renderTurn(failedTurn("This turn was resumed elsewhere.", "continuation_resumed")),
        ).toContain("Try again")
    })

    it("offers the key escape when the starter grant is spent, and takes the reader there", () => {
        const shown = renderTurn(failedTurn("Out of starter credits.", "starter_credits_exhausted"))

        expect(shown).toContain("Out of starter credits.")
        expect(shown).toContain("Add your key")

        press("Add your key")

        expect(routerPush).toHaveBeenCalledWith("/w/ws-1/p/proj-1/settings?tab=llms")
    })

    it("offers the sign-in escape when the subscription login is dead, to the same page", () => {
        // A dead subscription sign-in is not fixed by a key, but it is fixed on the same page: the
        // AI providers page is where a new device login happens. One destination, as on the desktop.
        const shown = renderTurn(
            failedTurn("Your Claude sign-in expired.", "subscription_login_required"),
        )

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
