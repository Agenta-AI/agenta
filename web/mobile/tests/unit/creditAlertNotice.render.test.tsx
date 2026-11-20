// @vitest-environment jsdom
/**
 * The credit card above the composer. Where the agent's model is not the person's to change (the
 * builder chat), it offers no "Switch model" and drops the line that asks for it; every other
 * chat keeps them.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {CreditAlertNotice, type ShownAlert} from "@/features/wallet/CreditAlertNotice"
import type {CreditFunding} from "@/features/wallet/modelFunding"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const render = (alert: ShownAlert, funding: CreditFunding, canSwitchModel?: boolean) =>
    act(() =>
        root.render(
            <CreditAlertNotice
                alert={alert}
                funding={funding}
                canBuy
                canSwitchModel={canSwitchModel}
                onAction={() => undefined}
                onDismiss={() => undefined}
            />,
        ),
    )

const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent)

const low: ShownAlert = {kind: "low", remainingMusd: 2_000_000}

describe("CreditAlertNotice", () => {
    it("offers Switch model in a session chat, as before", () => {
        render(low, "credits-with-own-key")
        expect(buttons()).toContain("Switch model")
        expect(host.textContent).toContain("Switch to your own model key to save credits.")
        render({kind: "empty"}, "credits-with-own-key")
        expect(buttons()).toContain("Switch model")
        render({kind: "daily", todayMusd: null, refills: true}, "credits-with-own-key")
        expect(buttons()).toContain("Switch model")
    })

    it("offers no Switch model and drops its line where the model is not the person's", () => {
        render(low, "credits-with-own-key", false)
        expect(buttons()).not.toContain("Switch model")
        expect(buttons()).toContain("Buy credits")
        expect(host.textContent).not.toContain("Switch to your own model key")
        expect(host.textContent).toContain("credits left.")
        render({kind: "empty"}, "credits-with-own-key", false)
        expect(buttons()).toEqual(["Buy credits"])
        render({kind: "daily", todayMusd: null, refills: true}, "credits-with-own-key", false)
        expect(buttons()).not.toContain("Switch model")
    })

    it("keeps the add-key part as before when the person has no own key", () => {
        render(low, "credits-no-own-key", false)
        expect(buttons()).toContain("Add a key")
        expect(host.textContent).toContain("Add your own model key to save credits.")
    })
})
