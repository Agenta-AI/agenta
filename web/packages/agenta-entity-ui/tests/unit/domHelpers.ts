/** Small DOM helpers for render tests that use react-dom directly (no testing library here). */
import {act} from "react"

/** The innermost element whose text is exactly `text` (buttons first), or undefined. */
export const byText = (
    text: string,
    selector = "button, span, div, p, a, label, h2",
): HTMLElement | undefined => {
    const nodes = [...document.querySelectorAll<HTMLElement>(selector)]
    return nodes.find(
        (node) =>
            (node.textContent ?? "").trim() === text &&
            ![...node.children].some((child) => (child.textContent ?? "").trim() === text),
    )
}

export const waitFor = async (check: () => void, timeout = 5000): Promise<void> => {
    const start = Date.now()
    for (;;) {
        try {
            check()
            return
        } catch (error) {
            if (Date.now() - start > timeout) throw error
            await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
        }
    }
}

/** Waits for an element: by its exact text, or, with an empty text, by `selector` alone. */
export const findByText = async (text: string, selector?: string): Promise<HTMLElement> => {
    let found: HTMLElement | undefined
    await waitFor(() => {
        found = text
            ? byText(text, selector)
            : (document.querySelector<HTMLElement>(selector ?? "*") ?? undefined)
        if (!found) throw new Error(`not found: ${text || selector}`)
    })
    return found!
}

export const click = async (element: Element | undefined | null): Promise<void> => {
    if (!element) throw new Error("nothing to click")
    await act(async () => (element as HTMLElement).click())
}

/** Sets a React-controlled input or textarea value and fires its input event. */
export const change = async (element: Element, value: string): Promise<void> => {
    const proto = Object.getPrototypeOf(element) as object
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    await act(async () => {
        setter?.call(element, value)
        element.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

export const keyDown = async (element: Element, key: string): Promise<void> => {
    await act(async () => {
        element.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}))
    })
}
