// @vitest-environment jsdom
/**
 * The queue panel's keys and focus: the first field takes the focus, the keys act only on the
 * field in focus, a pick moves the focus on, the arrows stay with a field that uses them, and the
 * help line follows the field in focus. The panel is drawn as the queue draws it, on the shared
 * fake controllers.
 */
import {act} from "react"

import {Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({next: vi.fn(), prev: vi.fn()}))

vi.mock("@agenta/annotation", async (importOriginal) => {
    const fake = await import("../support/annotationSessionFake")
    return {
        ...(await importOriginal<typeof import("@agenta/annotation")>()),
        annotationSessionController: fake.annotationSessionController,
        annotationFormController: fake.annotationFormController,
    }
})
vi.mock("@agenta/ui/app-message", () => ({message: {success: vi.fn(), error: vi.fn()}}))

import {AnnotationFormPanel} from "@/features/annotations/AnnotationFormPanel"
import {QueueSubmitBar} from "@/features/annotations/QueueSubmitBar"
import {useAnnotationKeyboardShortcuts} from "@/features/annotations/useAnnotationKeyboardShortcuts"
import {useFieldFocus} from "@/features/annotations/useFieldFocus"
import {useSubmitAnnotations} from "@/features/annotations/useSubmitAnnotations"

import {callsOf, fakeStore, resetSession} from "../support/annotationSessionFake"

const noop = () => undefined
globalThis.ResizeObserver ??= class {
    observe = noop
    unobserve = noop
    disconnect = noop
} as unknown as typeof ResizeObserver

/** The queue's panel column: the form with field keys, the button bar and the item keys. */
const Panel = () => {
    const focus = useFieldFocus("s-1", true)
    const submission = useSubmitAnnotations("s-1", {queueId: "queue-1"})
    useAnnotationKeyboardShortcuts({
        onPrev: nav.prev,
        onNext: nav.next,
        onSubmit: noop,
        hasPrev: true,
        hasNext: true,
        canSubmit: false,
        enabled: true,
    })
    return (
        <div ref={focus.ref} onFocus={focus.onFocus} onBlur={focus.onBlur}>
            <AnnotationFormPanel scenarioId="s-1" queueId="queue-1" fieldKeys />
            <QueueSubmitBar scenarioId="s-1" submission={submission} focused={focus.focused} />
        </div>
    )
}

let host: HTMLDivElement
let root: Root

const render = async () => {
    await act(async () =>
        root.render(
            <Provider store={fakeStore}>
                <Panel />
            </Provider>,
        ),
    )
}
const fields = () => Array.from(host.querySelectorAll<HTMLElement>("[data-annotation-field]"))
const focusedField = () => document.activeElement?.closest("[data-annotation-field]") ?? null
const press = async (key: string, target: EventTarget = document.activeElement!) => {
    await act(async () =>
        target.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true})),
    )
}
const metricWrites = () =>
    callsOf("updateMetric").map((payload) => {
        const {fieldKey, value} = payload as {fieldKey: string; value: unknown}
        return [fieldKey, value]
    })

beforeEach(() => {
    vi.clearAllMocks()
    resetSession({
        hasFilledMetrics: {"s-1": true},
        metrics: {
            "s-1": {
                tone: {
                    verdict: {
                        value: null,
                        type: ["string", "null"],
                        enum: ["correct", "partly correct", "wrong"],
                    },
                    confidence: {value: 0.5, type: "number", minimum: 0, maximum: 1},
                    cites_source: {value: null, type: "boolean"},
                    safe_to_send: {value: null, type: "boolean"},
                    note: {value: null, type: "string"},
                },
            },
        },
    })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the queue panel's keys and focus", () => {
    it("gives the first field the focus when the item opens", async () => {
        await render()
        expect(focusedField()).toBe(fields()[0])
    })

    it("picks a choice button with its number key and moves the focus to the next field", async () => {
        await render()
        await press("2")
        expect(metricWrites()).toEqual([["verdict", "partly correct"]])
        // The next field is the slider: it takes the focus on its thumb.
        expect(focusedField()).toBe(fields()[1])
        expect(document.activeElement?.getAttribute("role")).toBe("slider")
    })

    it("picks True with 1 on a boolean and False with 2, only on the field in focus", async () => {
        await render()
        await act(async () => fields()[2].focus())
        await press("1")
        expect(metricWrites()).toEqual([["cites_source", true]])
        expect(focusedField()).toBe(fields()[3])
        await press("2")
        expect(metricWrites().at(-1)).toEqual(["safe_to_send", false])
        // The note types the key: no pick.
        expect(focusedField()).toBe(fields()[4])
        await press("1")
        expect(metricWrites()).toHaveLength(2)
    })

    it("a key outside the options does nothing", async () => {
        await render()
        await press("4")
        expect(metricWrites()).toEqual([])
    })

    it("a click on True moves the focus on as a key does", async () => {
        await render()
        const trueButton = Array.from(fields()[2].querySelectorAll("button")).find((button) =>
            button.textContent?.startsWith("True"),
        )!
        await act(async () => trueButton.click())
        expect(metricWrites()).toEqual([["cites_source", true]])
        expect(focusedField()).toBe(fields()[3])
    })

    it("the arrows stay with the slider and move between items elsewhere", async () => {
        await render()
        await act(async () => fields()[1].querySelector<HTMLElement>("[role=slider]")!.focus())
        await press("ArrowRight")
        expect(nav.next).not.toHaveBeenCalled()
        await act(async () => fields()[2].focus())
        await press("ArrowRight")
        expect(nav.next).toHaveBeenCalledTimes(1)
    })

    it("the help line follows the field in focus", async () => {
        await render()
        expect(host.textContent).toContain("Keys: 1 to 3 pick an option, ← → move between items")
        await act(async () => fields()[2].focus())
        expect(host.textContent).toContain("Keys: 1 True, 2 False, ← → move between items")
        await act(async () => fields()[1].querySelector<HTMLElement>("[role=slider]")!.focus())
        expect(host.textContent).toContain(
            "Arrow keys change the value by 0.1. Tab moves to the next field.",
        )
        await act(async () => fields()[4].querySelector("textarea")!.focus())
        expect(host.textContent).toContain("Keys act on the field with the outline.")
    })

    it("shows the keys of the field in focus only", async () => {
        await render()
        const keyCaps = (field: HTMLElement) =>
            Array.from(field.querySelectorAll("kbd")).map((kbd) => kbd.className)
        // The caps are drawn hidden and show through the focus-within rule of their field.
        expect(
            keyCaps(fields()[0]).every((name) => name.includes("group-focus-within/field")),
        ).toBe(true)
        expect(fields()[0].className).toContain("group/field")
        expect(fields()[0].className).toContain("focus-ring-field")
    })

    it("more than 5 options stay a dropdown with no number keys", async () => {
        resetSession({
            metrics: {
                "s-1": {
                    tone: {
                        category: {
                            value: null,
                            type: ["string", "null"],
                            enum: ["a", "b", "c", "d", "e", "f"],
                        },
                    },
                },
            },
        })
        await render()
        expect(host.querySelector("[role=combobox]")).not.toBeNull()
        expect(fields()[0].dataset.fieldKind).toBe("other")
        await act(async () => fields()[0].focus())
        await press("1", fields()[0])
        expect(metricWrites()).toEqual([])
    })
})
