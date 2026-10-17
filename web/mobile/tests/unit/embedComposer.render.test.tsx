// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {EmbedComposer} from "@/features/embed/EmbedComposer"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | null = null
afterEach(() => {
    act(() => root?.unmount())
    root = null
    document.body.innerHTML = ""
})

const mount = (onSend: (text: string, files: File[]) => Promise<boolean>) => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() =>
        root?.render(<EmbedComposer disabled={false} placeholder="Message" onSend={onSend} />),
    )
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement
    const type = (value: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
        act(() => {
            setter?.call(textarea, value)
            textarea.dispatchEvent(new Event("input", {bubbles: true}))
        })
    }
    const pressEnter = async () => {
        await act(async () => {
            textarea.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
        })
    }
    return {textarea, type, pressEnter}
}

describe("EmbedComposer", () => {
    it("sends on Enter and clears the draft once the send is accepted", async () => {
        const onSend = vi.fn(async () => true)
        const {textarea, type, pressEnter} = mount(onSend)

        type("  hello  ")
        await pressEnter()

        expect(onSend).toHaveBeenCalledWith("hello", [])
        expect(textarea.value).toBe("")
    })

    it("keeps the draft when the send is refused", async () => {
        const {textarea, type, pressEnter} = mount(async () => false)

        type("hello")
        await pressEnter()

        expect(textarea.value).toBe("hello")
    })
})
