// @vitest-environment jsdom
/**
 * One annotation field: the control its schema type picks, and what each control writes back.
 */
import {act} from "react"

import type {AnnotationMetricField} from "@agenta/annotation"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// Radix measures the slider thumb; jsdom has no ResizeObserver.
const noop = () => undefined
globalThis.ResizeObserver ??= class {
    observe = noop
    unobserve = noop
    disconnect = noop
} as unknown as typeof ResizeObserver

// jsdom has no pointer capture; the slider calls these on a press.
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => undefined
Element.prototype.releasePointerCapture ??= () => undefined

// Menus and selects render inline: Radix opens them on a pointer sequence jsdom does not send.
vi.mock("@agenta/ui/ui", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/ui/ui")>()
    const Pass = ({children}: {children?: React.ReactNode}) => <div>{children}</div>
    return {
        ...actual,
        DropdownMenu: Pass,
        DropdownMenuTrigger: Pass,
        DropdownMenuContent: Pass,
        DropdownMenuCheckboxItem: ({
            children,
            checked,
            onCheckedChange,
        }: {
            children: React.ReactNode
            checked: boolean
            onCheckedChange: (checked: boolean) => void
        }) => (
            <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => onCheckedChange(!checked)}
            >
                {children}
            </button>
        ),
        // A text box stands in for the select's choice, so a case can pick an option's value.
        Select: ({
            children,
            onValueChange,
        }: {
            children: React.ReactNode
            onValueChange: (value: string) => void
        }) => (
            <div>
                {children}
                <input
                    data-testid="select"
                    onChange={(event) => onValueChange(event.target.value)}
                />
            </div>
        ),
        SelectTrigger: Pass,
        SelectValue: ({placeholder}: {placeholder?: string}) => <span>{placeholder}</span>,
        SelectContent: Pass,
        SelectItem: ({children, value}: {children: React.ReactNode; value: string}) => (
            <div role="option" aria-selected={false} data-value={value}>
                {children}
            </div>
        ),
    }
})

import {AnnotationField} from "@/features/annotations/AnnotationField"

let host: HTMLDivElement
let root: Root
const onChange = vi.fn()

const render = async (field: AnnotationMetricField, readOnly = false) => {
    await act(async () =>
        root.render(
            <AnnotationField
                fieldKey="score"
                field={field}
                readOnly={readOnly}
                onChange={onChange}
            />,
        ),
    )
}
const button = (label: string) => {
    const found = Array.from(host.querySelectorAll("button")).find(
        (b) => b.textContent === label || b.getAttribute("aria-label") === label,
    )
    expect(found, label).toBeDefined()
    return found as HTMLButtonElement
}
const typeInto = async (input: HTMLInputElement, text: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
        setter.call(input, text)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

beforeEach(() => {
    onChange.mockReset()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("an annotation field", () => {
    it("A boolean field sets true and false", async () => {
        await render({value: null, type: "boolean"})
        await act(async () => button("True").click())
        expect(onChange).toHaveBeenLastCalledWith(true)
        await act(async () => button("False").click())
        expect(onChange).toHaveBeenLastCalledWith(false)
    })

    it("An integer field with a range rounds the value", async () => {
        await render({value: null, type: "integer", minimum: 0, maximum: 10})
        const input = host.querySelector("input") as HTMLInputElement
        await typeInto(input, "3.6")
        expect(onChange).toHaveBeenLastCalledWith(4)
    })

    it("An empty number field shows no value on the slider", async () => {
        await render({value: null, type: "number", minimum: 0, maximum: 1})
        // The thumb and the filled track are hidden: an unset metric must not look set.
        expect(host.querySelector("[data-slot=slider][data-empty]")).not.toBeNull()
        expect((host.querySelector("input") as HTMLInputElement).value).toBe("")

        // The hidden thumb still takes the first move, from the minimum.
        const thumb = host.querySelector("[role=slider]") as HTMLElement
        await act(async () =>
            thumb.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true})),
        )
        expect(onChange).toHaveBeenLastCalledWith(0.1)

        await render({value: 0.4, type: "number", minimum: 0, maximum: 1})
        expect(host.querySelector("[data-slot=slider][data-empty]")).toBeNull()
        expect(host.querySelector("[role=slider]")?.getAttribute("aria-valuenow")).toBe("0.4")
    })

    it("The minimum of an empty slider can be picked by a key or a press", async () => {
        const thumbOf = () => host.querySelector("[role=slider]") as HTMLElement
        await render({value: null, type: "integer", minimum: 1, maximum: 5})
        await act(async () =>
            thumbOf().dispatchEvent(new KeyboardEvent("keydown", {key: "Home", bubbles: true})),
        )
        expect(onChange).toHaveBeenLastCalledWith(1)

        onChange.mockClear()
        const thumb = thumbOf()
        thumb.setPointerCapture = noop
        await act(async () => {
            thumb.dispatchEvent(new Event("pointerdown", {bubbles: true}))
            thumb.dispatchEvent(new Event("pointerup", {bubbles: true}))
        })
        expect(onChange).toHaveBeenLastCalledWith(1)

        // A set slider is left alone by a press that does not move it.
        onChange.mockClear()
        await render({value: 3, type: "integer", minimum: 1, maximum: 5})
        await act(async () => thumbOf().dispatchEvent(new Event("pointerup", {bubbles: true})))
        expect(onChange).not.toHaveBeenCalled()
    })

    it("A read-only number keeps both controls out of reach", async () => {
        await render({value: 3, type: "integer", minimum: 1, maximum: 5}, true)
        const input = host.querySelector("input") as HTMLInputElement
        expect(input.closest("[inert]")).not.toBeNull()
        expect(host.querySelector("[data-slot=slider]")?.closest("[inert]")).not.toBeNull()
    })

    it("A multi select allows only the listed values and sets null when emptied", async () => {
        await render({
            value: ["fast"],
            type: "array",
            items: {type: "string", enum: ["fast", "kind"]},
        })
        // The options are the schema's values; there is no box to type a new one.
        expect(host.querySelector("input, textarea")).toBeNull()
        expect(
            Array.from(host.querySelectorAll("[role=menuitemcheckbox]")).map((b) => b.textContent),
        ).toEqual(["fast", "kind"])

        const option = (label: string) =>
            Array.from(host.querySelectorAll<HTMLButtonElement>("[role=menuitemcheckbox]")).find(
                (b) => b.textContent === label,
            )!
        await act(async () => option("kind").click())
        expect(onChange).toHaveBeenLastCalledWith(["fast", "kind"])
        await act(async () => option("fast").click())
        expect(onChange).toHaveBeenLastCalledWith(null)
    })

    it("A null enum option reads none of the above", async () => {
        await render({value: null, type: ["string", "null"], enum: ["good", null]})
        const options = Array.from(host.querySelectorAll("[role=option]")).map((o) => o.textContent)
        expect(options).toEqual(["good", "none of the above"])
        expect(host.textContent).toContain("Select")
    })

    it("Picking none of the above saves it as a value, not as empty", async () => {
        await render({value: null, type: ["string", "null"], enum: ["good", null]})
        const select = host.querySelector("[data-testid=select]") as HTMLInputElement
        await typeInto(select, "good")
        expect(onChange).toHaveBeenLastCalledWith("good")
        await typeInto(select, "null")
        // Stored as the old view stored it: a real null would read as "no value".
        expect(onChange).toHaveBeenLastCalledWith("null")
    })

    it("Clear sets the value to null and is disabled when empty", async () => {
        await render({value: "Clear and kind", type: "string"})
        expect(button("Clear value").disabled).toBe(false)
        await act(async () => button("Clear value").click())
        expect(onChange).toHaveBeenLastCalledWith(null)

        await render({value: null, type: "string"})
        expect(button("Clear value").disabled).toBe(true)

        // Read only keeps the value on screen but takes no edits, and nothing is cleared.
        await render({value: true, type: "boolean"}, true)
        expect(button("Clear value").disabled).toBe(true)
    })

    it("An empty text sets null", async () => {
        await render({value: "ok", type: "string"})
        const textarea = host.querySelector("textarea") as HTMLTextAreaElement
        expect(textarea.placeholder).toBe("Enter a value")
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
        await act(async () => {
            setter.call(textarea, "")
            textarea.dispatchEvent(new Event("input", {bubbles: true}))
        })
        expect(onChange).toHaveBeenLastCalledWith(null)
    })
})
