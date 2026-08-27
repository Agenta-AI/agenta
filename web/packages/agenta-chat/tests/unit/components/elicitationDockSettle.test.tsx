/**
 * @vitest-environment jsdom
 *
 * The docked question card's settle channel and its reserved box.
 *
 * Replaces `ElicitationWidget.settleOnce.test.tsx`: the latch moved here with the actions. It is
 * still load-bearing — `meta.settled` only flips after the host's awaited record write, so between
 * a Send click and that write the card is still showing live Decline and Dismiss controls. Without
 * the latch the second click sends a competing answer for the same `toolCallId` and the runner
 * resumes on whichever lands last.
 */
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {ElicitationDock} from "../../../src/components/ElicitationDock"
import type {ElicitationDockState} from "../../../src/hooks/useElicitationDock"
import type {ClientToolMeta} from "../../../src/skin"

const metaWith = (input: unknown): ClientToolMeta =>
    ({
        toolCallId: "call_1",
        toolName: "__ag__request_input",
        renderKind: "elicitation",
        state: "input-available",
        input,
        output: undefined,
        settled: false,
        part: {} as never,
    }) as ClientToolMeta

const TWO_QUESTIONS = {
    message: "A few details",
    requestedSchema: {
        type: "object",
        properties: {
            name: {type: "string", title: "Your name"},
            colour: {type: "string", title: "Colour", enum: ["Red", "Blue"]},
        },
        required: ["name"],
    },
}

// This config sets no `globals`, so RTL never registers its auto-cleanup and mounted cards would
// otherwise pile up in one document (ApprovalCard.test.tsx unmounts by hand for the same reason).
afterEach(cleanup)

const setup = (input: unknown = TWO_QUESTIONS) => {
    const onOutput = vi.fn()
    const meta = metaWith(input)
    const elicits: ElicitationDockState = {
        open: true,
        front: meta,
        queue: [meta],
        shortcutsEnabled: true,
    }
    const view = render(<ElicitationDock elicits={elicits} onOutput={onOutput} />)
    return {...view, onOutput}
}

describe("the reserved box", () => {
    it("gives every state the same minimum height, so answering never moves the composer", () => {
        const {container} = setup()
        const card = container.querySelector('[role="group"]') as HTMLElement

        expect(card.style.minHeight).toBe("168px")
    })

    it("renders the nav even with nowhere to go — an on-demand slot would shift the row", () => {
        setup()

        expect((screen.getByLabelText("Previous question") as HTMLButtonElement).disabled).toBe(
            true,
        )
        expect(screen.getByText("1/2")).toBeTruthy()
    })
})

describe("chrome", () => {
    it("uses real Button components for the nav, so a disabled control stays chrome-less", () => {
        // A raw <button> here grew a visible 1px box the moment it was disabled — the exact case
        // the `ghost` variant's own note in @agenta/ui warns about.
        setup()

        for (const label of ["Previous question", "Next question", "Dismiss this request"]) {
            expect(screen.getByLabelText(label).dataset.slot).toBe("button")
        }
    })

    it("titles the card in the primary text colour, not the brand accent or caps", () => {
        const {container} = setup()
        const eyebrow = [...container.querySelectorAll("span")].find(
            (node) => node.textContent === "Request input",
        )

        expect(eyebrow?.className).toContain("text-colorText")
        expect(eyebrow?.className).not.toContain("uppercase")
    })

    it("fills progress by POSITION, not by which answers happen to be filled in", () => {
        // Answeredness jumps around as defaults land and steps are skipped, which reads as noise.
        const {container} = setup()
        const filled = () =>
            [...container.querySelectorAll("[aria-hidden] > span")].map((node) =>
                node.className.includes("bg-colorText") ? "filled" : "empty",
            )

        expect(filled()).toEqual(["filled", "empty"])

        fireEvent.change(screen.getByLabelText("Your name"), {target: {value: "Ada"}})
        fireEvent.click(screen.getByText("Next"))

        expect(filled()).toEqual(["filled", "filled"])
    })
})

describe("settling", () => {
    it("sends the answered values once the review is confirmed", () => {
        const {onOutput} = setup()

        fireEvent.change(screen.getByLabelText("Your name"), {target: {value: "Ada"}})
        fireEvent.click(screen.getByText("Next"))
        fireEvent.click(screen.getByText("Blue"))
        fireEvent.click(screen.getByText("Review"))
        fireEvent.click(screen.getByText("Send answers"))

        expect(onOutput).toHaveBeenCalledTimes(1)
        expect(onOutput.mock.calls[0][0].output).toMatchObject({
            action: "accept",
            content: {name: "Ada", colour: "Blue"},
        })
    })

    it("blocks a required question instead of settling", () => {
        const {onOutput} = setup()

        fireEvent.click(screen.getByText("Next"))

        expect(screen.getByText("This one is required")).toBeTruthy()
        expect(onOutput).not.toHaveBeenCalled()
    })

    it("dismisses from the header", () => {
        const {onOutput} = setup()

        fireEvent.click(screen.getByLabelText("Dismiss this request"))
        expect(onOutput.mock.calls[0][0].output).toMatchObject({action: "cancel"})
    })

    it("declines from the review screen", () => {
        const {onOutput} = setup()

        fireEvent.change(screen.getByLabelText("Your name"), {target: {value: "Ada"}})
        fireEvent.click(screen.getByText("Next"))
        fireEvent.click(screen.getByText("Review"))
        fireEvent.click(screen.getByText("Decline"))

        expect(onOutput.mock.calls[0][0].output).toMatchObject({action: "decline"})
    })

    it("settles exactly once — a second click after the first is inert", () => {
        const {onOutput} = setup()

        fireEvent.click(screen.getByLabelText("Dismiss this request"))
        fireEvent.click(screen.getByLabelText("Dismiss this request"))

        expect(onOutput).toHaveBeenCalledTimes(1)
    })
})

describe("refusal", () => {
    it("explains a secret-shaped request rather than drawing a form for it", () => {
        setup({
            message: "Paste your key",
            requestedSchema: {type: "object", properties: {api_key: {type: "string"}}},
        })

        expect(screen.getByText(/forms never carry secrets/)).toBeTruthy()
        expect(screen.getByText(/Connect the credential instead/)).toBeTruthy()
    })
})
