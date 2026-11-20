// @vitest-environment jsdom
/**
 * The credit card above the composer. Where the agent's model is not the person's to change (the
 * builder chat), it offers no "Switch model" and drops the line that asks for it; every other
 * chat keeps them.
 */
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {CreditAlertNotice, type ShownAlert} from "@/features/wallet/CreditAlertNotice"
import type {CreditFunding} from "@/features/wallet/modelFunding"

afterEach(cleanup)

const show = (alert: ShownAlert, funding: CreditFunding, canSwitchModel?: boolean) => {
    cleanup()
    render(
        <CreditAlertNotice
            alert={alert}
            funding={funding}
            canBuy
            canSwitchModel={canSwitchModel}
            onAction={() => undefined}
            onDismiss={() => undefined}
        />,
    )
}

const button = (name: string) => screen.queryByRole("button", {name})

const low: ShownAlert = {kind: "low", remainingMusd: 2_000_000}
const daily: ShownAlert = {kind: "daily", todayMusd: null, refills: true}

describe("CreditAlertNotice", () => {
    it("offers Switch model in a session chat, as before", () => {
        show(low, "credits-with-own-key")
        expect(button("Switch model")).not.toBeNull()
        expect(screen.getByText(/Switch to your own model key to save credits\./)).toBeTruthy()
        show({kind: "empty"}, "credits-with-own-key")
        expect(button("Switch model")).not.toBeNull()
        show(daily, "credits-with-own-key")
        expect(button("Switch model")).not.toBeNull()
    })

    it("offers no Switch model and drops its line where the model is not the person's", () => {
        show(low, "credits-with-own-key", false)
        expect(button("Switch model")).toBeNull()
        expect(button("Buy credits")).not.toBeNull()
        expect(screen.queryByText(/Switch to your own model key/)).toBeNull()
        expect(screen.getByText(/credits left\.$/)).toBeTruthy()
        show({kind: "empty"}, "credits-with-own-key", false)
        expect(button("Switch model")).toBeNull()
        expect(button("Buy credits")).not.toBeNull()
        show(daily, "credits-with-own-key", false)
        expect(button("Switch model")).toBeNull()
    })

    it("keeps the add-key part as before when the person has no own key", () => {
        show(low, "credits-no-own-key", false)
        expect(button("Add a key")).not.toBeNull()
        expect(screen.getByText(/Add your own model key to save credits\./)).toBeTruthy()
    })
})
