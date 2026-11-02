// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

const copy = vi.hoisted(() => vi.fn())

vi.mock("@agenta/ui/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/ui/utils")>()),
    copyToClipboard: copy,
}))

import {InvitedLinkDialog} from "@/features/settings/InvitedLinkDialog"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const URL_VALUE = "https://app.example.com/m/auth?token=t"
let root: Root | undefined

const mount = (invited: {email: string; url: string} | null) => {
    root = createRoot(document.createElement("div"))
    act(() => root!.render(<InvitedLinkDialog invited={invited} onClose={vi.fn()} />))
}

const copyButton = () =>
    Array.from(document.body.querySelectorAll("button")).find((item) =>
        item.textContent?.startsWith("Cop"),
    )

afterEach(() => {
    act(() => root?.unmount())
    copy.mockReset()
})

describe("the invited user link dialog", () => {
    it("stays closed until the API returned a link", () => {
        mount(null)
        expect(document.body.textContent).not.toContain("Invited user link")
    })

    it("shows the person and the link, and copies the link", async () => {
        copy.mockResolvedValue(true)
        mount({email: "a@b.c", url: URL_VALUE})
        expect(document.body.textContent).toContain("a@b.c")
        expect(document.body.textContent).toContain(URL_VALUE)
        await act(async () => copyButton()?.click())
        expect(copy).toHaveBeenCalledWith(URL_VALUE)
        expect(copyButton()?.textContent).toBe("Copied")
    })

    it("does not claim a copy the browser refused", async () => {
        copy.mockResolvedValue(false)
        mount({email: "a@b.c", url: URL_VALUE})
        await act(async () => copyButton()?.click())
        expect(copyButton()?.textContent).toBe("Copy")
    })
})
