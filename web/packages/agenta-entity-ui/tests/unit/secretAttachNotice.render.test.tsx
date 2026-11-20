/**
 * "Attach a secret" (F04 f6, f7): the "Save or discard…" notice waits until the agent's draft
 * stays dirty, so a save in flight does not flash it; and "Who can use it" is the shared
 * two-choice switch.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useHeldTrue} from "../../src/secret/attach/SecretAttachFields"
import {OwnerRadioGroup} from "../../src/secret/OwnerRadioGroup"

let host: HTMLDivElement
let root: Root

const Probe = ({value}: {value: boolean}) =>
    createElement("span", null, useHeldTrue(value, 1500) ? "shown" : "hidden")

const renderProbe = async (value: boolean) => {
    await act(async () => root.render(createElement(Probe, {value})))
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe("the agent changes notice", () => {
    it("does not show for a draft that is dirty only while a save runs", async () => {
        vi.useFakeTimers()
        await renderProbe(true)
        expect(host.textContent).toBe("hidden")
        await act(async () => vi.advanceTimersByTime(1000))
        // The save lands: the draft is clean again.
        await renderProbe(false)
        await act(async () => vi.advanceTimersByTime(2000))
        expect(host.textContent).toBe("hidden")
    })

    it("shows once the draft stays dirty, and hides at once when it is clean", async () => {
        vi.useFakeTimers()
        await renderProbe(true)
        await act(async () => vi.advanceTimersByTime(1500))
        expect(host.textContent).toBe("shown")
        await renderProbe(false)
        expect(host.textContent).toBe("hidden")
    })
})

describe("Who can use it", () => {
    it("is the two-choice switch: two radios side by side, each with its note", async () => {
        const onChange = vi.fn()
        await act(async () =>
            root.render(
                createElement(OwnerRadioGroup<"user" | "project">, {
                    value: "user",
                    onChange,
                    options: [
                        {value: "user", label: "Only me", note: "Your own value."},
                        {value: "project", label: "Everyone in Acme", note: "Shared."},
                    ],
                }),
            ),
        )
        const group = host.querySelector('[role="radiogroup"]')
        expect(group?.getAttribute("aria-label")).toBe("Who can use it")
        const radios = [...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]')]
        expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false"])
        expect(radios[1]?.textContent).toBe("Everyone in AcmeShared.")
        await act(async () => radios[1]?.click())
        expect(onChange).toHaveBeenCalledWith("project")
    })
})
