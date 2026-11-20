/** The account switch: checked state, click, arrow keys and focus, disabled. */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AccountSwitch} from "../../src/accounts/AccountSwitch"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const choices = [
    {value: "user", label: "Each person's own", note: "Everyone uses their own Zendesk account."},
    {value: "agent", label: "One shared account", note: "Everyone uses the account you pick."},
]

const render = async (props: {
    value: string
    onChange: (v: string) => void
    disabled?: boolean
}) => {
    await act(async () => {
        root.render(
            createElement(AccountSwitch<string>, {...props, choices, "aria-label": "Account"}),
        )
    })
}

const radios = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'))

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

describe("AccountSwitch", () => {
    it("checks the current choice and shows each note", async () => {
        await render({value: "agent", onChange: () => undefined})
        const [own, shared] = radios()
        expect(own.getAttribute("aria-checked")).toBe("false")
        expect(shared.getAttribute("aria-checked")).toBe("true")
        expect(shared.tabIndex).toBe(0)
        expect(own.tabIndex).toBe(-1)
        expect(host.textContent).toContain("Everyone uses their own Zendesk account.")
        expect(host.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe(
            "Account",
        )
    })

    it("a click on the other choice picks it; a click on the current one does nothing", async () => {
        const onChange = vi.fn()
        await render({value: "user", onChange})
        await act(async () => radios()[0].click())
        expect(onChange).not.toHaveBeenCalled()
        await act(async () => radios()[1].click())
        expect(onChange).toHaveBeenCalledWith("agent")
    })

    it("an arrow key moves to the next choice, wrapping at the end", async () => {
        const onChange = vi.fn()
        await render({value: "agent", onChange})
        const [own, shared] = radios()
        shared.focus()
        await act(async () => {
            shared.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}))
        })
        expect(onChange).toHaveBeenCalledWith("user")
        expect(document.activeElement).toBe(own)
    })

    it("a disabled switch picks nothing", async () => {
        const onChange = vi.fn()
        await render({value: "user", onChange, disabled: true})
        await act(async () => radios()[1].click())
        const group = host.querySelector('[role="radiogroup"]')!
        await act(async () => {
            group.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}))
        })
        expect(onChange).not.toHaveBeenCalled()
    })
})
