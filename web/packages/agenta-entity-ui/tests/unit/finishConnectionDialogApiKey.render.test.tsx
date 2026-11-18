/**
 * Finishing a pending connection: OAuth reopens its sign-in, but an API-key connection has no
 * sign-in window, so "Authorize" and the sign-in copy do not belong to it.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {FinishConnectionDialog} from "../../src/gatewayTool/components/FinishConnectionDialog"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | null = null

afterEach(() => {
    act(() => root?.unmount())
    root = null
    document.body.innerHTML = ""
})

const dialog = (apiKey: boolean) => {
    root = createRoot(document.body.appendChild(document.createElement("div")))
    act(() =>
        root!.render(
            createElement(FinishConnectionDialog, {
                open: true,
                name: "Tavily",
                logo: null,
                apiKey,
                onAuthorize: vi.fn(async () => undefined),
                onDelete: vi.fn(),
                onClose: vi.fn(),
            }),
        ),
    )
    const buttons = Array.from(document.querySelectorAll("button")).map((b) => b.textContent)
    return {buttons, text: document.body.textContent ?? ""}
}

describe("FinishConnectionDialog", () => {
    it("offers Authorize for an OAuth sign-in that was never completed", () => {
        expect(dialog(false).buttons.some((label) => label?.includes("Authorize"))).toBe(true)
    })

    it("has no Authorize and no sign-in copy for an API-key connection", () => {
        const {buttons, text} = dialog(true)
        expect(buttons.some((label) => label?.includes("Authorize"))).toBe(false)
        expect(text).not.toContain("sign-in")
        expect(text).toContain("API key")
    })
})
