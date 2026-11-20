/**
 * The key form's "Active models": 60 rows, then "Show all"; a typed id that is not in the list
 * becomes an "Add" row; the line under the list follows the fetch with the stored key.
 */
import {act, createElement} from "react"

import type {ModelOption} from "@agenta/entities/secret"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import ActiveModelsSection, {
    type ActiveModelsSectionProps,
} from "../../src/secretProvider/ActiveModelsSection"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const options = (count: number): ModelOption[] =>
    Array.from({length: count}, (_, index) => ({
        id: `model-${index}`,
        checked: index < 3,
        isDefault: index < 3,
        unavailable: false,
    }))

const render = async (props: Partial<ActiveModelsSectionProps> = {}) => {
    const onAddManual = vi.fn()
    await act(async () => {
        root.render(
            createElement(ActiveModelsSection, {
                options: options(5),
                onToggle: vi.fn(),
                onSelectAll: vi.fn(),
                onClear: vi.fn(),
                onAddManual,
                manualPlaceholder: "Add a model ID",
                ...props,
            }),
        )
    })
    return {onAddManual}
}

const text = () => host.textContent ?? ""
const rows = () => host.querySelectorAll('[role="checkbox"]').length

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})

describe("Active models", () => {
    it("shows 60 rows and Show all above 60 models", async () => {
        await render({options: options(140)})
        expect(rows()).toBe(60)
        expect(text()).toContain("Show all 140")
        expect(text()).toContain("Active models · 3 of 140")
    })

    it("offers a typed id that is not in the list as an Add row, and Enter adds it", async () => {
        const {onAddManual} = await render()
        const search = host.querySelector<HTMLInputElement>("input")
        if (!search) throw new Error("no search field")
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
                search,
                "gpt-6-preview",
            )
            search.dispatchEvent(new Event("input", {bubbles: true}))
        })
        expect(text()).toContain("Add gpt-6-preview")

        await act(async () => {
            search.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
        })
        expect(onAddManual).toHaveBeenCalledWith("gpt-6-preview")
    })

    it("follows the fetch with the stored key in the line under the list", async () => {
        await render({refreshing: true, onRefresh: vi.fn()})
        expect(text()).toContain("Updating the list…")

        await render({unreachableNote: "Agenta could not reach OpenAI.", onRefresh: vi.fn()})
        expect(text()).toContain("Agenta could not reach OpenAI.")
        expect(text()).toContain("Update")

        await render({fetchedAt: new Date().toISOString(), onRefresh: vi.fn()})
        expect(text()).toContain("List updated just now ·")
    })
})
