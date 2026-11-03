// @vitest-environment jsdom
import {act} from "react"

import type {OrganizationDomain} from "@agenta/entities/organization"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

import {AddDomainDialog} from "@/features/settings/AddDomainDialog"
import {DomainDnsInstructions} from "@/features/settings/DomainDnsInstructions"

const button = (label: string) =>
    Array.from(document.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === label,
    )

const typeInto = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

describe("AddDomainDialog", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("does not submit an empty domain", async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined)
        await act(async () => {
            root.render(<AddDomainDialog open onClose={vi.fn()} onSubmit={onSubmit} />)
        })

        await act(async () => {
            button("Add domain")!.click()
        })

        expect(onSubmit).not.toHaveBeenCalled()
    })

    it("submits the trimmed domain and closes on success", async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined)
        const onClose = vi.fn()
        await act(async () => {
            root.render(<AddDomainDialog open onClose={onClose} onSubmit={onSubmit} />)
        })

        await typeInto(document.querySelector("input") as HTMLInputElement, "  example.com  ")
        await act(async () => {
            button("Add domain")!.click()
        })

        expect(onSubmit).toHaveBeenCalledWith("example.com")
        expect(onClose).toHaveBeenCalled()
    })

    it("keeps the typed value and shows a plain error on failure", async () => {
        const onSubmit = vi.fn().mockRejectedValue(new Error("Domain already verified"))
        await act(async () => {
            root.render(<AddDomainDialog open onClose={vi.fn()} onSubmit={onSubmit} />)
        })

        const input = document.querySelector("input") as HTMLInputElement
        await typeInto(input, "example.com")
        await act(async () => {
            button("Add domain")!.click()
        })

        expect(input.value).toBe("example.com")
        expect(document.querySelector("[role=alert]")?.textContent).toBe("Could not add the domain")
    })
})

describe("DomainDnsInstructions", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("shows the exact TXT record and copies its value without logging the token", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {writeText},
        })
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
        const domain = {
            id: "dom-1",
            slug: "example.com",
            token: "secret-token",
            flags: {is_verified: false},
        } as unknown as OrganizationDomain

        await act(async () => {
            root.render(<DomainDnsInstructions domain={domain} />)
        })

        expect(document.body.textContent).toContain("_agenta-verification.example.com")
        expect(document.body.textContent).toContain("Type: TXT")
        expect(document.body.textContent).toContain("_agenta-verification=secret-token")

        await act(async () => {
            button("Copy value")!.click()
        })

        expect(writeText).toHaveBeenCalledWith("_agenta-verification=secret-token")
        expect(log).not.toHaveBeenCalled()
        log.mockRestore()
    })
})
