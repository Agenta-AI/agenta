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
        Select: Pass,
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
        expect(host.querySelector("[data-slot=slider]")).not.toBeNull()
        // No thumb at the minimum: an unset metric must not look set.
        expect(host.querySelectorAll("[role=slider]")).toHaveLength(0)
        expect((host.querySelector("input") as HTMLInputElement).value).toBe("")

        // The first press on the empty track sets the value under the pointer.
        const track = host.querySelector("[data-slot=slider]")!.parentElement as HTMLDivElement
        track.getBoundingClientRect = () => ({left: 0, width: 200}) as DOMRect
        await act(async () =>
            track.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true, clientX: 150})),
        )
        expect(onChange).toHaveBeenLastCalledWith(0.8)

        await render({value: 0.4, type: "number", minimum: 0, maximum: 1})
        const thumb = host.querySelector("[role=slider]")
        expect(thumb?.getAttribute("aria-valuenow")).toBe("0.4")
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
