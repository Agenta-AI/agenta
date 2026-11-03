// @vitest-environment jsdom
/** One input card: each value kind edits as its native type, a draft shows its shape, copy works. */
import {act, useState} from "react"

import type {PlaygroundInputVariable} from "@agenta/playground-ui/hooks"
import {InputVariableCard} from "@agenta/playground-ui/panels/inputs"
import {variableViewModeAtomFamily} from "@agenta/playground-ui/state"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest"

const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn()}))
vi.mock("@agenta/ui/app-message", () => ({message: toast}))
// The code editor is Lexical; a textarea stands in for it and reports each edit.
vi.mock("@agenta/ui/shared-editor", () => ({
    SharedEditor: ({
        initialValue,
        handleChange,
    }: {
        initialValue: string
        handleChange?: (value: string) => void
    }) => (
        <textarea
            data-testid="code"
            defaultValue={initialValue}
            onChange={(event) => handleChange?.(event.target.value)}
        />
    ),
}))

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let onValueChange: Mock<(name: string, value: unknown) => void>

const render = async (variable: PlaygroundInputVariable, rowId = "row-1") => {
    await act(async () =>
        root.render(
            <InputVariableCard
                rowId={rowId}
                variable={variable}
                editable
                onValueChange={onValueChange}
            />,
        ),
    )
}
const type = async (field: HTMLElement, value: string) => {
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!
    await act(async () => {
        setter.call(field, value)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    onValueChange = vi.fn()
    toast.success.mockClear()
    toast.error.mockClear()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("InputVariableCard", () => {
    it("A text variable edits as a string", async () => {
        await render({name: "country", value: "France"})

        await type(host.querySelector("textarea")!, "Spain")

        expect(onValueChange).toHaveBeenLastCalledWith("country", "Spain")
    })

    it("A number variable stores a number, not a string", async () => {
        await render({name: "age", value: 30})

        await type(host.querySelector('input[type="number"]')!, "42")

        expect(onValueChange).toHaveBeenLastCalledWith("age", 42)
    })

    it("A number field cleared and typed again still stores a number", async () => {
        const Echo = () => {
            const [value, setValue] = useState<unknown>(30)
            return (
                <InputVariableCard
                    rowId="row-1"
                    variable={{name: "age", value}}
                    editable
                    onValueChange={(name, next) => {
                        setValue(next)
                        onValueChange(name, next)
                    }}
                />
            )
        }
        await act(async () => root.render(<Echo />))

        await type(host.querySelector('input[type="number"]')!, "")
        await type(host.querySelector('input[type="number"]')!, "42")

        expect(onValueChange).toHaveBeenNthCalledWith(1, "age", null)
        expect(onValueChange).toHaveBeenLastCalledWith("age", 42)
    })

    it("A draft number variable stores a number from its first character", async () => {
        await render({name: "count", value: undefined, isDraft: true, expectedType: "number"})

        await type(host.querySelector('input[type="number"]')!, "4")

        expect(onValueChange).toHaveBeenLastCalledWith("count", 4)
    })

    it("A boolean variable toggles with the switch", async () => {
        await render({name: "formal", value: false})

        await act(async () => host.querySelector<HTMLElement>('[role="switch"]')!.click())

        expect(onValueChange).toHaveBeenLastCalledWith("formal", true)
    })

    it("Invalid JSON keeps the last valid value", async () => {
        await render({name: "filters", value: {a: 1}})
        await act(async () =>
            store.set(variableViewModeAtomFamily({rowId: "row-1", varName: "filters"}), "json"),
        )

        await type(host.querySelector('[data-testid="code"]')!, '{"a": 2')
        expect(onValueChange).not.toHaveBeenCalled()

        await type(host.querySelector('[data-testid="code"]')!, '{"a": 2}')
        expect(onValueChange).toHaveBeenLastCalledWith("filters", {a: 2})
    })

    it("A draft variable shows the draft badge and its schema shape", async () => {
        await render({
            name: "geo",
            value: undefined,
            isDraft: true,
            expectedType: "object",
            expectedSchema: {type: "object", properties: {region: {type: "string"}}},
        })

        expect(host.textContent).toContain("draft")
        expect(host.textContent).toContain("region")
        // The shape is only shown: nothing is stored until the user edits.
        expect(onValueChange).not.toHaveBeenCalled()
    })

    it("The chosen view belongs to one row and one variable", async () => {
        const card = (rowId: string, name: string) => (
            <InputVariableCard
                key={`${rowId}-${name}`}
                rowId={rowId}
                variable={{name, value: {a: 1}}}
                editable
                onValueChange={onValueChange}
            />
        )
        await act(async () =>
            root.render(
                <>
                    {card("row-1", "filters")}
                    {card("row-2", "filters")}
                    {card("row-1", "other")}
                </>,
            ),
        )
        await act(async () =>
            store.set(variableViewModeAtomFamily({rowId: "row-1", varName: "filters"}), "json"),
        )

        // Only the card of that row and that variable switched to the code view.
        expect(host.querySelectorAll('[data-testid="code"]')).toHaveLength(1)
        const switched = host.querySelector('[data-testid="code"]')!
        expect(switched.closest('[data-testid="input-variable-filters"]')).not.toBeNull()
    })

    it("Copy value copies the displayed value and shows Copied", async () => {
        const writeText = vi.fn(async () => undefined)
        Object.assign(navigator, {clipboard: {writeText}})
        await render({name: "filters", value: {a: 1}})

        await act(async () =>
            host.querySelector<HTMLElement>('[aria-label="Copy filters"]')!.click(),
        )

        expect(writeText).toHaveBeenCalledWith(JSON.stringify({a: 1}, null, 2))
        expect(toast.success).toHaveBeenCalledWith("Copied")
    })

    it("A refused copy shows Copy failed", async () => {
        Object.assign(navigator, {
            clipboard: {writeText: async () => Promise.reject(new Error("no"))},
        })
        await render({name: "country", value: "France"})

        await act(async () =>
            host.querySelector<HTMLElement>('[aria-label="Copy country"]')!.click(),
        )

        expect(toast.error).toHaveBeenCalledWith("Copy failed")
    })
})
