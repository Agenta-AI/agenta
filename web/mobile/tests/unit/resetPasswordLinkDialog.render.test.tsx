// @vitest-environment jsdom
import {act} from "react"

import type {WorkspaceMember} from "@agenta/entities/organization"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const copy = vi.hoisted(() => vi.fn())

vi.mock("@agenta/ui/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/ui/utils")>()),
    copyToClipboard: copy,
}))

import {ResetPasswordLinkDialog} from "@/features/settings/ResetPasswordLinkDialog"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const LINK = "https://app.example.com/reset/one-time"
const member: WorkspaceMember = {
    user: {
        id: "user-2",
        email: "alice@example.com",
        username: "Alice",
        status: "member",
        created_at: "2026-01-01T00:00:00Z",
    },
    roles: [],
}

let root: Root
let host: HTMLDivElement

const button = (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (item) => item.textContent?.trim() === label,
    )

// Like MembersTab, the host clears the target when the dialog asks to close.
const mount = (target: WorkspaceMember | null, onRequest = vi.fn().mockResolvedValue(LINK)) => {
    const render = (current: WorkspaceMember | null) =>
        root.render(
            <ResetPasswordLinkDialog
                target={current}
                onRequest={onRequest}
                onClose={() => render(null)}
            />,
        )
    return act(() => render(target))
}

const flush = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
    copy.mockReset()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const generate = async () => {
    await act(async () => button("Generate link")?.click())
}

describe("ResetPasswordLinkDialog", () => {
    it("asks for confirmation and requests nothing until the reader confirms", async () => {
        const onRequest = vi.fn().mockResolvedValue(LINK)
        mount(member, onRequest)
        await flush()

        expect(onRequest).not.toHaveBeenCalled()
        expect(button("Generate link")).not.toBeUndefined()
        expect(document.body.textContent).not.toContain(LINK)

        await generate()
        await flush()
        expect(onRequest).toHaveBeenCalledTimes(1)
        expect(document.body.textContent).toContain(LINK)
    })

    it("shows no link until the request resolves", async () => {
        let resolve: (value: string) => void = () => undefined
        const onRequest = vi.fn(
            () =>
                new Promise<string>((done) => {
                    resolve = done
                }),
        )
        mount(member, onRequest)
        await generate()
        expect(document.body.textContent).toContain("Generating a one-time link…")
        expect(document.body.textContent).not.toContain(LINK)

        await act(async () => resolve(LINK))
        expect(document.body.textContent).toContain(LINK)
    })

    it("copies the link", async () => {
        copy.mockResolvedValue(true)
        mount(member)
        await generate()
        await flush()

        expect(document.body.textContent).toContain(LINK)
        await act(async () => button("Copy")?.click())
        expect(copy).toHaveBeenCalledWith(LINK)
        expect(button("Copied")).not.toBeUndefined()
    })

    it("removes the link from the document when closed", async () => {
        mount(member)
        await generate()
        await flush()
        expect(document.body.textContent).toContain(LINK)

        await act(async () => button("Close")?.click())
        expect(document.body.textContent).not.toContain(LINK)
    })

    it("shows only the safe server error when the request fails", async () => {
        const onRequest = vi.fn().mockRejectedValue({
            statusCode: 403,
            body: {detail: "The organization owner's password cannot be reset this way."},
        })
        mount(member, onRequest)
        await generate()
        await flush()

        expect(document.querySelector("[role=alert]")?.textContent).toBe(
            "The organization owner's password cannot be reset this way.",
        )
        expect(document.body.textContent).not.toContain(LINK)
    })
})
