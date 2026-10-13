// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {PendingTaskError} from "@/features/chat/states/PendingTaskError"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    host?.remove()
    root = undefined
    host = undefined
})

const render = async (props: React.ComponentProps<typeof PendingTaskError>) => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(<PendingTaskError {...props} />))
    return host
}

describe("PendingTaskError", () => {
    it("separates the failure reason from the saved-draft reassurance", async () => {
        const view = await render({
            failureReason: "connection resolution failed (HTTP 500)",
            retryDisabled: false,
            onRetry: vi.fn(),
        })
        const alert = view.querySelector('[role="alert"]')!
        expect(Array.from(alert.querySelectorAll("p"), (p) => p.textContent)).toEqual([
            "Message not sent",
            "connection resolution failed (HTTP 500)",
            "Your text and attachments are saved.",
        ])
        expect(view.className).toBe("")
        expect(view.firstElementChild?.className).toContain("px-3")
        expect(alert.parentElement?.className).toContain("bg-colorErrorBg")
        expect(alert.parentElement?.className).toContain("sm:flex-row")
        expect(alert.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
    })

    it("retries only when the existing admission gates allow it", async () => {
        const onRetry = vi.fn()
        const view = await render({retryDisabled: true, onRetry})
        const button = view.querySelector("button")!
        expect(button.disabled).toBe(true)
        await act(async () => button.click())
        expect(onRetry).not.toHaveBeenCalled()
        await act(async () =>
            root!.render(<PendingTaskError retryDisabled={false} onRetry={onRetry} />),
        )
        await act(async () => view.querySelector("button")!.click())
        expect(onRetry).toHaveBeenCalledOnce()
    })

    it("shows attachment names without HTML injection and wraps long details", async () => {
        const reason = "<script>" + "connection_".repeat(80) + "</script>"
        const filename = "very-long-".repeat(80) + ".pdf"
        const view = await render({
            failureReason: reason,
            filenames: [filename, "", filename],
            retryDisabled: false,
            onRetry: vi.fn(),
        })
        expect(view.querySelector("script")).toBeNull()
        expect(view.querySelector('[role="alert"]')?.textContent).toContain(reason)
        const items = view.querySelectorAll('[aria-label="Saved attachments"] li')
        expect(Array.from(items, (item) => item.textContent)).toEqual([
            filename,
            "Attachment",
            filename,
        ])
        expect(items[0].className).toContain("[overflow-wrap:anywhere]")
        expect(view.querySelectorAll("p")[1].className).toContain("[overflow-wrap:anywhere]")
    })

    it("keeps the fallback useful when no failure detail or attachments exist", async () => {
        const view = await render({retryDisabled: false, onRetry: vi.fn()})
        expect(view.querySelectorAll("p")).toHaveLength(2)
        expect(view.querySelector("ul")).toBeNull()
        expect(view.textContent).toContain("Your text and attachments are saved.")
        expect(view.querySelector("button")?.textContent).toBe("Retry message")
    })
})
