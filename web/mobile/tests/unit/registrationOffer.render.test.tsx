// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
// Radix measures its controls; jsdom has no ResizeObserver.
const noop = () => undefined
globalThis.ResizeObserver ??= class {
    observe = noop
    unobserve = noop
    disconnect = noop
} as unknown as typeof ResizeObserver

const fixture = vi.hoisted(() => ({register: vi.fn()}))

vi.mock("../../src/features/settings/licenseApi", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    createInstanceRegistration: fixture.register,
}))

import {WithQueryClient} from "../support/queryClient"

import {RegistrationOffer} from "@/features/onboarding/RegistrationOffer"
import {isLargeCompany, shouldOfferRegistration} from "@/features/onboarding/registrationOfferRules"

describe("registration offer rules", () => {
    it("adds the Enterprise line for 51 people or more", () => {
        expect(isLargeCompany({size: "2-10"})).toBe(false)
        expect(isLargeCompany({size: "51-200"})).toBe(true)
        expect(isLargeCompany({size: "201+"})).toBe(true)
        expect(isLargeCompany({})).toBe(false)
    })

    it("offers only to the instance admin of a self-hosted instance with no key", () => {
        const base = {selfHosted: true, isInstanceAdmin: true, hasKey: false}
        expect(shouldOfferRegistration(base)).toBe(true)
        expect(shouldOfferRegistration({...base, selfHosted: false})).toBe(false)
        expect(shouldOfferRegistration({...base, isInstanceAdmin: false})).toBe(false)
        expect(shouldOfferRegistration({...base, hasKey: true})).toBe(false)
    })
})

describe("RegistrationOffer", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        fixture.register.mockReset().mockResolvedValue({email: "ada@example.com"})
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const mount = async (largeCompany: boolean, onClose = vi.fn()) => {
        await act(async () => {
            root.render(
                <WithQueryClient>
                    <RegistrationOffer
                        open
                        projectId="proj-1"
                        email="ada@example.com"
                        largeCompany={largeCompany}
                        onClose={onClose}
                    />
                </WithQueryClient>,
            )
        })
        return onClose
    }
    const button = (label: string) =>
        Array.from(document.querySelectorAll("button")).find(
            (node) => node.textContent?.trim() === label,
        )

    it("fills in the email and leaves out the Enterprise line for a small team", async () => {
        await mount(false)

        expect(document.querySelector<HTMLInputElement>("input[type=email]")?.value).toBe(
            "ada@example.com",
        )
        expect(document.body.textContent).not.toContain("Talk to us about Enterprise")
    })

    it("shows the Enterprise line for a larger company", async () => {
        await mount(true)

        expect(document.body.textContent).toContain("Talk to us about Enterprise")
    })

    it("closes on Skip", async () => {
        const onClose = await mount(false)

        act(() => button("Skip")!.click())

        expect(onClose).toHaveBeenCalledOnce()
        expect(fixture.register).not.toHaveBeenCalled()
    })

    it("leaves the consent box clear, and sends nothing until the user checks it", async () => {
        await mount(false)

        const consent = document.querySelector<HTMLElement>("[role=checkbox]")!
        expect(consent.getAttribute("aria-checked")).toBe("false")
        expect(button("Send me a key")!.hasAttribute("disabled")).toBe(true)

        await act(async () => {
            button("Send me a key")!.click()
        })
        expect(fixture.register).not.toHaveBeenCalled()
    })

    it("registers with the email and consent to product updates", async () => {
        await mount(false)

        act(() => document.querySelector<HTMLElement>("[role=checkbox]")!.click())
        await act(async () => {
            button("Send me a key")!.click()
        })

        expect(fixture.register).toHaveBeenCalledWith("proj-1", "ada@example.com", true)
        expect(document.body.textContent).toContain("We sent a key to ada@example.com.")
    })

    it("says the email is not valid when the API refuses it, with no retry prompt", async () => {
        fixture.register.mockReset().mockRejectedValue({response: {status: 422}})
        await mount(false)

        act(() => document.querySelector<HTMLElement>("[role=checkbox]")!.click())
        await act(async () => {
            button("Send me a key")!.click()
        })

        await vi.waitFor(() =>
            expect(document.querySelector("[role=alert]")?.textContent).toBe(
                "Enter a valid email address.",
            ),
        )
        expect(document.querySelector("input[type=email]")?.getAttribute("aria-invalid")).toBe(
            "true",
        )
        expect(document.body.textContent).not.toContain("Try again")
    })
})
