/**
 * @vitest-environment jsdom
 *
 * The builder's "Decisions for you" form (task 28.2): one recorded `request_input` call shown by
 * today's ElicitationDock, and the answer payload it sends back to the builder.
 */
import {buildElicitationSteps, parseElicitationPayload} from "@agenta/shared/utils"
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    CHOICE_FORM_INPUT,
    CHOICE_FORM_NOTES,
    makeChoiceFormDockState,
} from "../../../../../storybook/fixtures/builderLayout/choice-form"
import {ElicitationDock} from "../../../src/components/ElicitationDock"

afterEach(cleanup)

// A fresh draft store per test: the card restores a saved draft by tool call id.
beforeEach(() => {
    let store = new Map<string, string>()
    const stub: Storage = {
        get length() {
            return store.size
        },
        clear: () => void (store = new Map()),
        getItem: (key) => store.get(key) ?? null,
        key: (index) => [...store.keys()][index] ?? null,
        removeItem: (key) => void store.delete(key),
        setItem: (key, value) => void store.set(key, String(value)),
    }
    Object.defineProperty(window, "localStorage", {value: stub, configurable: true})
})

const setup = () => {
    const onOutput = vi.fn()
    const view = render(<ElicitationDock elicits={makeChoiceFormDockState()} onOutput={onOutput} />)
    return {...view, onOutput}
}

const next = () => fireEvent.keyDown(screen.getByRole("group"), {key: "Enter", metaKey: true})

describe("the recorded request_input call", () => {
    it("parses, and asks the two choices and the multiline field in the written order", () => {
        const parsed = parseElicitationPayload(CHOICE_FORM_INPUT)
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) return

        const {steps} = buildElicitationSteps(parsed.payload)
        expect(steps.map((step) => [step.name, step.kind])).toEqual([
            ["trigger", "enum"],
            ["reply", "enum"],
            ["notes", "multiline"],
        ])
        // The recommended option is first and is the default.
        for (const step of steps.filter((candidate) => candidate.kind === "enum")) {
            expect(step.default).toBe(step.options?.[0].value)
        }
    })
})

describe("what the form shows", () => {
    it("shows the first decision with its options, the recommended one first", () => {
        const {container} = setup()

        expect(container.querySelector("[data-elicitation-message]")?.textContent).toBe(
            "Two decisions before I build the agent.",
        )
        expect(screen.getByText("1/3")).toBeTruthy()
        expect(container.textContent).toContain("When should the agent run?")
        const text = container.textContent ?? ""
        expect(text.indexOf("On every new ticket")).toBeGreaterThan(-1)
        expect(text.indexOf("On every new ticket")).toBeLessThan(text.indexOf("Once a day"))
    })
})

describe("the answer payload", () => {
    it("sends the defaults and the typed note as one accept result", async () => {
        const {onOutput} = setup()

        next() // decision 1: the default stays
        next() // decision 2: the default stays
        fireEvent.change(screen.getByRole("textbox"), {target: {value: CHOICE_FORM_NOTES}})
        next() // review
        next() // send

        await waitFor(() => expect(onOutput).toHaveBeenCalledTimes(1))
        expect(onOutput).toHaveBeenCalledWith({
            toolName: "request_input",
            toolCallId: "call_choice_form",
            output: {
                action: "accept",
                content: {trigger: "new_ticket", reply: "draft", notes: CHOICE_FORM_NOTES},
                humanFriendlyMessage: "Provided the requested input.",
            },
        })
    })

    it("sends the option the person picks instead of the default, and leaves a skipped note out", async () => {
        const {onOutput} = setup()

        fireEvent.click(screen.getByText("Once a day"))
        next() // to decision 2
        next() // to the note
        fireEvent.click(screen.getByText("Skip"))
        next() // send from the review

        await waitFor(() => expect(onOutput).toHaveBeenCalledTimes(1))
        const {output} = onOutput.mock.calls[0][0]
        expect(output.action).toBe("accept")
        expect(output.content).toEqual({trigger: "daily", reply: "draft"})
    })

    it("sends a decline result with no content when the person declines on the review", async () => {
        const {onOutput} = setup()

        next()
        next()
        next() // review
        fireEvent.click(screen.getByText("Decline"))

        await waitFor(() => expect(onOutput).toHaveBeenCalledTimes(1))
        expect(onOutput.mock.calls[0][0].output).toEqual({
            action: "decline",
            humanFriendlyMessage: "Declined the request.",
        })
    })
})
