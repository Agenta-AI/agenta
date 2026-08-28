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
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

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

/**
 * A fresh draft store per test. Every card here shares one `toolCallId`, so without this the
 * stepper restores the PREVIOUS test's draft and opens on the question that test left off at —
 * which is exactly how this file passed on Node 26 (whose own `localStorage` getter shadows
 * jsdom's and reads back undefined, so nothing ever persisted) and failed in CI.
 */
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
        fireEvent.keyDown(screen.getByRole("group"), {key: "Enter", metaKey: true})

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

    it("sends on Cmd+Enter from the review screen", () => {
        const {onOutput} = setup()

        fireEvent.change(screen.getByLabelText("Your name"), {target: {value: "Ada"}})
        fireEvent.click(screen.getByText("Next"))
        fireEvent.click(screen.getByRole("radio", {name: /Red/}))
        fireEvent.click(screen.getByText("Review"))
        expect(screen.getByText("Send answers")).toBeTruthy()

        fireEvent.keyDown(screen.getByRole("group"), {key: "Enter", metaKey: true})

        expect(onOutput).toHaveBeenCalledTimes(1)
        const {output} = onOutput.mock.calls[0][0]
        expect(output.content).toEqual({name: "Ada", colour: "Red"})
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

describe("automation", () => {
    it("advances on Cmd+Enter in a text field", () => {
        setup()

        fireEvent.change(screen.getByLabelText("Your name"), {target: {value: "Ada"}})
        // Plain Enter belongs to the field; the modifier is what leaves the step.
        fireEvent.keyDown(screen.getByLabelText("Your name"), {key: "Enter"})
        expect(screen.getByText("1/2")).toBeTruthy()

        fireEvent.keyDown(screen.getByLabelText("Your name"), {key: "Enter", metaKey: true})
        expect(screen.getByText("2/2")).toBeTruthy()
    })

    it("shows the validation error instead of advancing on an empty required field", () => {
        setup()

        fireEvent.keyDown(screen.getByLabelText("Your name"), {key: "Enter", metaKey: true})

        expect(screen.getByText("This one is required")).toBeTruthy()
        expect(screen.getByText("1/2")).toBeTruthy()
    })

    it("advances a textarea on Cmd+Enter, leaving plain Enter to the newline", () => {
        const {onOutput} = setup({
            message: "One question",
            requestedSchema: {
                type: "object",
                properties: {note: {type: "string", title: "Note", format: "multiline"}},
            },
        })
        const box = screen.getByLabelText("Note")

        fireEvent.change(box, {target: {value: "line one"}})
        fireEvent.keyDown(box, {key: "Enter", metaKey: true})

        // One question means no review step, so the modifier sends outright.
        expect(onOutput).toHaveBeenCalledTimes(1)
    })

    it("keeps Shift+Enter as the textarea's newline", () => {
        const {onOutput} = setup({
            message: "One question",
            requestedSchema: {
                type: "object",
                properties: {note: {type: "string", title: "Note", format: "multiline"}},
            },
        })
        const box = screen.getByLabelText("Note")

        fireEvent.change(box, {target: {value: "line one"}})
        fireEvent.keyDown(box, {key: "Enter", shiftKey: true})

        expect(onOutput).not.toHaveBeenCalled()
        expect(screen.getByText("1/1")).toBeTruthy()
    })

    it("leaves plain Enter alone in a textarea, so the browser inserts the newline", () => {
        const {onOutput} = setup({
            message: "One question",
            requestedSchema: {
                type: "object",
                properties: {notes: {type: "string", title: "Notes", format: "multiline"}},
            },
        })
        const field = screen.getByLabelText("Notes") as HTMLTextAreaElement

        fireEvent.change(field, {target: {value: "one"}})
        fireEvent.keyDown(field, {key: "Enter"})

        // Nothing intercepts it, so the browser's own newline stands and the step does not move.
        expect(onOutput).not.toHaveBeenCalled()
        expect(screen.getByText("1/1")).toBeTruthy()
    })

    it("advances immediately on a digit, with no hold", () => {
        setup()

        fireEvent.change(screen.getByLabelText("Your name"), {target: {value: "Ada"}})
        fireEvent.click(screen.getByText("Next"))
        fireEvent.keyDown(screen.getByRole("group"), {key: "2"})

        // No fake timers: an immediate pick must not need one.
        expect(screen.queryByText(/Picked/)).toBeNull()
        // Colour is the last question, so an immediate pick lands straight on the review screen.
        expect(screen.getByText("Send answers")).toBeTruthy()
    })

    it("holds before advancing when the row is CLICKED", () => {
        setup()

        fireEvent.change(screen.getByLabelText("Your name"), {target: {value: "Ada"}})
        fireEvent.click(screen.getByText("Next"))
        fireEvent.click(screen.getByText("Blue"))

        expect(screen.getByText("Picked Blue")).toBeTruthy()
    })

    it("focuses the Other field instead of dying on its digit", () => {
        // Both the digit and Enter used to hit `pickRow`, which bails on a null value.
        setup()

        fireEvent.change(screen.getByLabelText("Your name"), {target: {value: "Ada"}})
        fireEvent.click(screen.getByText("Next"))
        fireEvent.keyDown(screen.getByRole("group"), {key: "3"})

        expect(screen.getByText("2/2")).toBeTruthy()
    })
})

describe("multi-select", () => {
    const MULTI = {
        message: "Pick sections",
        requestedSchema: {
            type: "object",
            properties: {
                sections: {
                    type: "array",
                    title: "Sections",
                    items: {type: "string", enum: ["Issues", "PRs", "Releases"]},
                },
            },
        },
    }

    it("renders checkboxes, not radios", () => {
        setup(MULTI)
        expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0)
        expect(screen.queryAllByRole("radio")).toHaveLength(0)
    })

    it("toggles many on without ever advancing", () => {
        const {onOutput} = setup(MULTI)

        fireEvent.click(screen.getByText("Issues"))
        fireEvent.click(screen.getByText("Releases"))

        // Still on the one and only question — a checkbox list is not done until you say so.
        expect(screen.getByText("1/1")).toBeTruthy()
        expect(onOutput).not.toHaveBeenCalled()

        fireEvent.click(screen.getByText("Send answers"))
        expect(onOutput.mock.calls[0][0].output).toMatchObject({
            content: {sections: ["Issues", "Releases"]},
        })
    })

    it("toggles a picked option back off", () => {
        const {onOutput} = setup(MULTI)

        fireEvent.click(screen.getByText("Issues"))
        fireEvent.click(screen.getByText("Issues"))
        fireEvent.click(screen.getByText("Send answers"))

        expect(onOutput.mock.calls[0][0].output.content).toEqual({})
    })
})

describe("autofocus", () => {
    const TYPED = {
        message: "Three typed answers",
        requestedSchema: {
            type: "object",
            properties: {
                name: {type: "string", title: "Your name"},
                days: {type: "integer", title: "Days"},
                note: {type: "string", title: "Note", format: "multiline"},
            },
        },
    }

    /** The focus lands inside a requestAnimationFrame, which jsdom does not flush synchronously. */
    const focused = (label: string) =>
        waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(label)))

    it("focuses the first field on load, with no click", async () => {
        setup(TYPED)
        await focused("Your name")
    })

    it("follows the step forward, across input kinds", async () => {
        setup(TYPED)

        fireEvent.click(screen.getByText("Next"))
        await focused("Days")

        fireEvent.click(screen.getByText("Next"))
        // The textarea had no ref at all, so multiline was the one kind that never focused.
        await focused("Note")
    })

    it("follows the step BACK too, with the caret at the end of what is already there", async () => {
        setup(TYPED)

        fireEvent.change(screen.getByLabelText("Your name"), {target: {value: "Ada"}})
        fireEvent.click(screen.getByText("Next"))
        fireEvent.click(screen.getByLabelText("Previous question"))

        await focused("Your name")
        // Caret at the end so stepping back CONTINUES the answer instead of typing over it.
        expect((screen.getByLabelText("Your name") as HTMLInputElement).selectionStart).toBe(3)
    })

    it("leaves focus on the card for a pickable step, so digits still work", async () => {
        setup()
        fireEvent.change(screen.getByLabelText("Your name"), {target: {value: "Ada"}})
        fireEvent.click(screen.getByText("Next"))

        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("group")))
    })
})

describe("the controls the dialect grew", () => {
    const oneOf = (properties: Record<string, unknown>) => ({
        message: "One question",
        requestedSchema: {type: "object", properties},
    })

    it("gives a date step a picker, not a field to hand-type an ISO string into", async () => {
        setup(oneOf({due: {type: "string", title: "Due", format: "date"}}))

        const trigger = screen.getByLabelText("Due")
        expect(trigger.tagName).toBe("BUTTON")
        // Nothing focused would leave every card-level shortcut dead on this step.
        await waitFor(() => expect(document.activeElement).toBe(trigger))
    })

    it("sends a date as the wire string, never a dayjs object", () => {
        const {onOutput} = setup(oneOf({due: {type: "string", title: "Due", format: "date"}}))

        fireEvent.click(screen.getByLabelText("Due"))
        // react-day-picker names each day in full, e.g. "Wednesday, August 5th, 2026".
        fireEvent.click(screen.getAllByRole("button", {name: /, \d{4}$/})[8])
        fireEvent.click(screen.getByText("Send answers"))

        const {output} = onOutput.mock.calls[0][0]
        expect(output.content.due).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it("marks a picked multi-select row with a check, not a box before the label", () => {
        setup(
            oneOf({
                notify: {
                    type: "array",
                    title: "Notify on",
                    items: {type: "string", enum: ["success", "failure"]},
                },
            }),
        )

        const rows = screen.getAllByRole("checkbox")
        expect(rows.length).toBeGreaterThanOrEqual(2)
        // Nothing sits before the label: a box there read as a second thing to click.
        expect(rows[0].querySelector('[data-slot="checkbox"]')).toBeNull()
        expect(rows[0].querySelector("svg")).toBeNull()

        fireEvent.click(rows[0])

        expect(rows[0].getAttribute("aria-checked")).toBe("true")
        // The mark lands at the end of the row it belongs to, and only there.
        expect(rows[0].querySelector("svg")).toBeTruthy()
        expect(rows[1].querySelector("svg")).toBeNull()
    })

    it("keeps a oneOf description reachable without a tooltip on every row", () => {
        setup(
            oneOf({
                frequency: {
                    type: "string",
                    title: "Frequency",
                    enum: ["hourly"],
                    oneOf: [
                        {
                            const: "hourly",
                            title: "Hourly",
                            description: "Runs every hour, on the hour.",
                        },
                    ],
                },
            }),
        )

        const row = screen.getByRole("radio", {name: /Hourly/})
        // The row points at its own description rather than carrying a native title, which would
        // double up with the tooltip the `?` opens.
        expect(row.getAttribute("title")).toBeNull()
        const describedBy = row.getAttribute("aria-describedby")
        expect(describedBy).toBeTruthy()
        expect(document.getElementById(describedBy as string)?.textContent).toBe(
            "Runs every hour, on the hour.",
        )
    })

    it("keeps the cursor row in view once a long list starts scrolling", () => {
        const scrolled: {text: string; arg: {block?: string}}[] = []
        // jsdom does not implement scrollIntoView, so record the calls rather than the geometry.
        // Restored at the end: leaving the stub installed breaks every later test in this file.
        const original = Element.prototype.scrollIntoView
        Element.prototype.scrollIntoView = function (arg?: unknown) {
            scrolled.push({text: (this.textContent || "").trim(), arg: (arg ?? {}) as object})
        } as typeof Element.prototype.scrollIntoView
        try {
            setup(
                oneOf({
                    model: {
                        type: "string",
                        title: "Model",
                        enum: Array.from({length: 24}, (_, i) => `model-${i}`),
                    },
                }),
            )

            const card = screen.getByRole("group")
            for (let i = 0; i < 12; i++) fireEvent.keyDown(card, {key: "ArrowDown"})

            const last = scrolled[scrolled.length - 1]
            expect(last.text).toContain("model-12")
            // Anything but "nearest" scrolls the transcript behind the dock.
            expect(last.arg.block).toBe("nearest")
        } finally {
            Element.prototype.scrollIntoView = original
        }
    })

    it("adds an Other entry to a multi-select instead of replacing what is picked", () => {
        const {onOutput} = setup(
            oneOf({
                notify: {
                    type: "array",
                    title: "Notify on",
                    items: {type: "string", enum: ["success", "failure"]},
                },
            }),
        )

        fireEvent.click(screen.getAllByRole("checkbox")[0])
        fireEvent.change(screen.getByPlaceholderText(/Other/), {target: {value: "digest"}})
        fireEvent.click(screen.getByText("Send answers"))

        // Writing the scalar straight through dropped every picked option and put a string on a
        // wire the schema declared as an array.
        const {output} = onOutput.mock.calls[0][0]
        expect(output.content.notify).toEqual(["success", "digest"])
    })

    it("collects a free-form array as chips, one entry at a time", () => {
        const {onOutput} = setup(
            oneOf({repos: {type: "array", title: "Repos", items: {type: "string"}}}),
        )
        const field = screen.getByLabelText("Repos")

        fireEvent.change(field, {target: {value: "agenta"}})
        fireEvent.keyDown(field, {key: "Enter"})
        fireEvent.change(field, {target: {value: "docs"}})
        fireEvent.keyDown(field, {key: ","})

        expect(screen.getByText("agenta")).toBeTruthy()
        expect(screen.getByText("docs")).toBeTruthy()

        // Backspace on an empty field takes the last one back.
        fireEvent.keyDown(field, {key: "Backspace"})
        expect(screen.queryByText("docs")).toBeNull()

        // A repeat of an existing entry keeps what was typed and points at the chip that holds
        // it — silently doing nothing reads as the field dropping keystrokes.
        fireEvent.change(field, {target: {value: "agenta"}})
        fireEvent.keyDown(field, {key: "Enter"})
        expect((field as HTMLInputElement).value).toBe("agenta")
        expect(screen.getAllByText("agenta")).toHaveLength(1)

        fireEvent.change(field, {target: {value: ""}})
        // Enter only ever adds an entry here; the modifier is what settles the one-question form.
        fireEvent.keyDown(field, {key: "Enter"})
        expect(onOutput).not.toHaveBeenCalled()
        fireEvent.keyDown(field, {key: "Enter", metaKey: true})
        expect(onOutput).toHaveBeenCalledTimes(1)
        const {output} = onOutput.mock.calls[0][0]
        expect(output.content.repos).toEqual(["agenta"])
    })

    it("opens on the review screen when the schema already answered everything", () => {
        setup({
            message: "Confirm",
            requestedSchema: {
                type: "object",
                properties: {
                    region: {type: "string", title: "Region", default: "eu"},
                    retries: {type: "integer", title: "Retries", default: 3},
                },
            },
        })

        expect(screen.getByText("Send answers")).toBeTruthy()
        expect(screen.getByText("Region")).toBeTruthy()
    })
})
