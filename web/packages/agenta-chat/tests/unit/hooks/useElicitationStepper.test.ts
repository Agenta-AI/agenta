/**
 * @vitest-environment jsdom
 *
 * Unit tests for the docked question form's answer state.
 *
 * The behaviours worth pinning are the ones a render test would hide: what auto-advances and what
 * refuses to, that Skip clears a value rather than just moving past it, and that `Send answers`
 * carries exactly the answered keys.
 */
import {buildElicitationSteps, type ElicitationForm} from "@agenta/shared/utils"
import {act, renderHook} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useElicitationStepper} from "../../../src/hooks/useElicitationStepper"

const formOf = (properties: Record<string, unknown>, required: string[] = []): ElicitationForm =>
    buildElicitationSteps({
        message: "A few details",
        requestedSchema: {type: "object", properties, required},
    } as never)

const FIVE = formOf(
    {
        name: {type: "string", title: "Your name"},
        days: {type: "integer", title: "Days", minimum: 1, maximum: 90},
        colour: {type: "string", title: "Colour", enum: ["Red", "Blue", "Green"]},
        digest: {type: "boolean", title: "Digest"},
        note: {type: "string", title: "Note", format: "multiline"},
    },
    ["name", "colour"],
)

const setup = (form: ElicitationForm = FIVE, onComplete = vi.fn()) => {
    const view = renderHook(() => useElicitationStepper({form, toolCallId: "call_1", onComplete}))
    return {...view, onComplete}
}

/**
 * A persistence test owns its storage. Node 26 installs its own `localStorage` getter that shadows
 * jsdom's and reads back `undefined` unless the process was started with `--localstorage-file`, so
 * the ambient one cannot be relied on here (it is why `sessionMessages.test.ts` fails on Node 26).
 */
const installStorage = (): Storage => {
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
    return stub
}

let storage: Storage

beforeEach(() => {
    storage = installStorage()
})

afterEach(() => {
    vi.useRealTimers()
})

describe("navigation", () => {
    it("starts on the first question and counts the whole form", () => {
        const {result} = setup()

        expect(result.current.step?.name).toBe("name")
        expect(result.current.position).toBe(1)
        expect(result.current.total).toBe(5)
        expect(result.current.canGoBack).toBe(false)
        expect(result.current.primaryLabel).toBe("Next")
    })

    it("reads Review on the last question and Send answers on the summary", () => {
        const {result} = setup()

        act(() => result.current.goTo(4))
        expect(result.current.primaryLabel).toBe("Review")

        act(() => result.current.goTo(5))
        expect(result.current.isReview).toBe(true)
        expect(result.current.step).toBeNull()
        // The counter stays inside the question range on the summary.
        expect(result.current.position).toBe(5)
        expect(result.current.primaryLabel).toBe("Send answers")
    })

    it("clamps navigation to the form's ends", () => {
        const {result} = setup()

        act(() => result.current.back())
        expect(result.current.index).toBe(0)

        act(() => result.current.goTo(99))
        expect(result.current.index).toBe(5)
        expect(result.current.canGoForward).toBe(false)
    })

    it("skips the review screen for a one-question form", () => {
        const onComplete = vi.fn()
        const {result} = setup(formOf({name: {type: "string"}}), onComplete)

        expect(result.current.hasReview).toBe(false)
        expect(result.current.primaryLabel).toBe("Send answers")

        act(() => result.current.setValue("name", "Ada"))
        act(() => result.current.primary())
        expect(onComplete).toHaveBeenCalledWith({name: "Ada"})
    })
})

describe("a form the schema already answered", () => {
    const DEFAULTED = formOf({
        region: {type: "string", title: "Region", enum: ["eu", "us"], default: "eu"},
        retries: {type: "integer", title: "Retries", default: 3},
    })

    it("opens on review, so accepting the defaults is one keystroke", () => {
        const {result} = setup(DEFAULTED)

        expect(result.current.isReview).toBe(true)
        expect(result.current.primaryLabel).toBe("Send answers")
        expect(result.current.content).toEqual({region: "eu", retries: 3})
    })

    it("still lets the user walk back and change one", () => {
        const {result} = setup(DEFAULTED)

        act(() => result.current.goTo(1))

        expect(result.current.isReview).toBe(false)
        expect(result.current.step?.name).toBe("retries")
    })

    it("leaves a partly-defaulted form at question one", () => {
        const {result} = setup(
            formOf({
                region: {type: "string", title: "Region", default: "eu"},
                note: {type: "string", title: "Note"},
            }),
        )

        expect(result.current.isReview).toBe(false)
        expect(result.current.position).toBe(1)
    })

    it("has no review screen to open when there is only one question", () => {
        const {result} = setup(formOf({region: {type: "string", title: "Region", default: "eu"}}))

        expect(result.current.isReview).toBe(false)
        expect(result.current.primaryLabel).toBe("Send answers")
    })
})

describe("validation", () => {
    it("blocks a required question and clears the error on the next answer", () => {
        const {result} = setup()

        act(() => result.current.primary())
        expect(result.current.error).toBe("This one is required")
        expect(result.current.index).toBe(0)

        act(() => result.current.setValue("name", "Ada"))
        expect(result.current.error).toBeNull()

        act(() => result.current.primary())
        expect(result.current.index).toBe(1)
    })

    it("uses pick-one wording on an enum", () => {
        const {result} = setup()

        act(() => result.current.goTo(2))
        act(() => result.current.primary())
        expect(result.current.error).toBe("Pick one to continue")
    })

    it("lets an optional question through untouched", () => {
        const {result} = setup()

        act(() => result.current.goTo(1))
        act(() => result.current.primary())
        expect(result.current.index).toBe(2)
    })

    it("enforces the schema's numeric bounds", () => {
        const {result} = setup()

        act(() => result.current.goTo(1))
        act(() => result.current.setValue("days", 200))
        act(() => result.current.primary())
        expect(result.current.error).toBe("Must be 90 or less")
    })
})

describe("auto-advance", () => {
    it("advances a pick after the hold, showing the label meanwhile", () => {
        vi.useFakeTimers()
        const {result} = setup()

        act(() => result.current.goTo(2))
        act(() => result.current.pick("colour", "Blue", "Picked Blue", 1))

        expect(result.current.values.colour).toBe("Blue")
        expect(result.current.hold).toBe("Picked Blue")
        expect(result.current.index).toBe(2)

        act(() => void vi.advanceTimersByTime(900))
        expect(result.current.index).toBe(3)
        expect(result.current.hold).toBeNull()
    })

    it("holds when the user does anything before the timer fires", () => {
        vi.useFakeTimers()
        const {result} = setup()

        act(() => result.current.goTo(2))
        act(() => result.current.pick("colour", "Blue", "Picked Blue", 1))
        act(() => result.current.cancelHold())
        act(() => void vi.advanceTimersByTime(2000))

        // The value stuck; only the automatic move was cancelled.
        expect(result.current.values.colour).toBe("Blue")
        expect(result.current.index).toBe(2)
    })

    it("restarts the timer when the same option is picked twice", () => {
        vi.useFakeTimers()
        const {result} = setup()

        act(() => result.current.goTo(2))
        act(() => result.current.pick("colour", "Blue", "Picked Blue", 1))
        act(() => void vi.advanceTimersByTime(600))
        act(() => result.current.pick("colour", "Blue", "Picked Blue", 1))
        act(() => void vi.advanceTimersByTime(600))

        expect(result.current.index).toBe(2)
        act(() => void vi.advanceTimersByTime(400))
        expect(result.current.index).toBe(3)
    })

    it("never auto-advances free text — moving mid-sentence is worse than a click", () => {
        vi.useFakeTimers()
        const {result} = setup()

        act(() => result.current.setValue("name", "Ada"))
        act(() => void vi.advanceTimersByTime(5000))

        expect(result.current.index).toBe(0)
        expect(result.current.hold).toBeNull()
    })
})

describe("skip", () => {
    it("clears the value and advances", () => {
        const {result} = setup()

        act(() => result.current.setValue("name", "Ada"))
        act(() => result.current.skip())

        expect(result.current.values.name).toBeUndefined()
        expect(result.current.index).toBe(1)
        expect(result.current.content).toEqual({})
    })

    it("clears a schema default too — skipping means 'do not send this'", () => {
        const {result} = setup(formOf({tz: {type: "string", enum: ["UTC"], default: "UTC"}}))

        expect(result.current.content).toEqual({tz: "UTC"})
        act(() => result.current.skip())
        expect(result.current.content).toEqual({})
    })
})

describe("skip", () => {
    it("lets a one-question required form finish once its question is skipped", () => {
        // total === 1 has no next step to move to, so skip() leaves the index on the step it just
        // declined. Re-validating it there trapped the form with no way out.
        const onComplete = vi.fn()
        const {result} = setup(formOf({name: {type: "string"}}, ["name"]), onComplete)

        act(() => result.current.skip())
        act(() => result.current.primary())

        expect(result.current.error).toBeNull()
        expect(onComplete).toHaveBeenCalledWith({})
    })
})

describe("content", () => {
    it("sends exactly the answered keys", () => {
        const onComplete = vi.fn()
        const {result} = setup(FIVE, onComplete)

        act(() => result.current.setValue("name", "Ada"))
        act(() => result.current.setValue("days", 30))
        act(() => result.current.setValue("colour", "Blue"))
        act(() => result.current.setValue("digest", false))
        act(() => result.current.goTo(5))
        act(() => result.current.primary())

        expect(onComplete).toHaveBeenCalledWith({
            name: "Ada",
            days: 30,
            colour: "Blue",
            // `false` is an answer, not an absence.
            digest: false,
        })
    })

    it("counts answered and skipped for the review line", () => {
        const {result} = setup()

        act(() => result.current.setValue("name", "Ada"))
        act(() => result.current.setValue("colour", "Blue"))

        expect(result.current.answeredCount).toBe(2)
        expect(result.current.skippedCount).toBe(3)
    })
})

describe("draft", () => {
    it("carries the skips, so a reload does not resurrect a skipped default", () => {
        const form = formOf({
            region: {type: "string", title: "Region", default: "eu"},
            note: {type: "string", title: "Note"},
        })
        const first = setup(form)
        expect(first.result.current.content).toEqual({region: "eu"})

        // Skipping a defaulted field clears it. Saving only the values would restore the default
        // on the next mount and submit an answer the user explicitly declined.
        act(() => first.result.current.skip())
        expect(first.result.current.content).toEqual({})
        first.unmount()

        const second = setup(form)
        expect(second.result.current.content).toEqual({})
    })

    it("restores values and the user's place on remount", () => {
        vi.useFakeTimers()
        const first = setup()

        act(() => first.result.current.setValue("name", "Ada"))
        act(() => first.result.current.primary())
        act(() => void vi.advanceTimersByTime(500))
        first.unmount()
        vi.useRealTimers()

        const {result} = setup()
        expect(result.current.values.name).toBe("Ada")
        expect(result.current.index).toBe(1)
    })

    it("discards a draft whose keys no longer match the schema", () => {
        storage.setItem(
            "agenta:elicitation-draft:call_1",
            JSON.stringify({values: {gone: "x"}, index: 3}),
        )

        const {result} = setup()
        expect(result.current.values.gone).toBeUndefined()
        expect(result.current.index).toBe(0)
    })

    it("survives a corrupt draft", () => {
        storage.setItem("agenta:elicitation-draft:call_1", "{not json")
        expect(() => setup()).not.toThrow()
    })

    it("drops the saved draft when the card settles", () => {
        vi.useFakeTimers()
        const {result} = setup()

        act(() => result.current.setValue("name", "Ada"))
        act(() => void vi.advanceTimersByTime(500))
        expect(storage.getItem("agenta:elicitation-draft:call_1")).not.toBeNull()

        act(() => result.current.discardDraft())
        expect(storage.getItem("agenta:elicitation-draft:call_1")).toBeNull()
    })
})
