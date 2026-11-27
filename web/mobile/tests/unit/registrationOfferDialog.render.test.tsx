// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
const noop = () => undefined
globalThis.ResizeObserver ??= class {
    observe = noop
    unobserve = noop
    disconnect = noop
} as unknown as typeof ResizeObserver

const fixture = vi.hoisted(() => ({
    billing: false,
    license: null as unknown,
    notAdmin: false,
    pending: false,
    dismiss: vi.fn(),
}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    isBillingEnabled: () => fixture.billing,
}))

vi.mock("@agenta/entities/profile", () => ({
    useProfile: () => ({user: {id: "user-1", email: "admin@example.com"}}),
}))

vi.mock("@/features/onboarding/onboardingPending", () => ({
    isOnboardingPending: () => fixture.pending,
}))

// The lazy chunk loads in the app; the test renders the dialog without the loader.
vi.mock("next/dynamic", async () => {
    const {RegistrationOfferDialog} = await import("@/features/onboarding/RegistrationOfferDialog")
    return {default: () => RegistrationOfferDialog}
})

vi.mock("../../src/features/settings/licenseApi", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchInstanceLicense: async () => {
        if (fixture.notAdmin) throw {response: {status: 403}}
        return fixture.license
    },
    dismissRegistrationOffer: fixture.dismiss,
}))

import {RegistrationOfferGate} from "@/features/onboarding/RegistrationOfferGate"

import {WithQueryClient} from "../support/queryClient"

const unregistered = (dismissed = false) => ({
    plan: "self_hosted_community",
    source: null,
    license: null,
    usage: {users: 1},
    registration_offer_dismissed: dismissed,
})

describe("the registration offer after an upgrade", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        fixture.billing = false
        fixture.notAdmin = false
        fixture.pending = false
        fixture.license = unregistered()
        fixture.dismiss.mockReset().mockResolvedValue(undefined)
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const mount = async () => {
        await act(async () => {
            root.render(
                <WithQueryClient>
                    <RegistrationOfferGate projectId="proj-1" />
                </WithQueryClient>,
            )
        })
        // Let the license query settle.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20))
        })
    }
    const title = () =>
        Array.from(document.querySelectorAll("h2")).find(
            (node) => node.textContent === "Register this instance for free",
        )
    const button = (label: string) =>
        Array.from(document.querySelectorAll("button")).find(
            (node) => node.textContent?.trim() === label,
        )

    it("shows once for the admin of an upgraded instance with no key", async () => {
        await mount()

        await vi.waitFor(() => expect(title()).toBeDefined())
        expect(document.querySelector<HTMLInputElement>("input[type=email]")?.value).toBe(
            "admin@example.com",
        )
        expect(button("Send me a free key")).toBeDefined()
    })

    it("stores the skip on the instance and closes", async () => {
        await mount()
        await vi.waitFor(() => expect(title()).toBeDefined())

        await act(async () => {
            button("Skip")!.click()
        })

        expect(fixture.dismiss).toHaveBeenCalledWith("proj-1")
        await vi.waitFor(() => expect(title()).toBeUndefined())
    })

    it("does not show after a skip", async () => {
        fixture.license = unregistered(true)
        await mount()

        expect(title()).toBeUndefined()
    })

    it("does not show for a member", async () => {
        fixture.notAdmin = true
        await mount()

        expect(title()).toBeUndefined()
    })

    it("does not show when the instance has a key", async () => {
        fixture.license = {
            ...unregistered(),
            plan: "self_hosted_registered",
            license: {key_id: "k-1", plan: "self_hosted_registered"},
        }
        await mount()

        expect(title()).toBeUndefined()
    })

    it("does not show on cloud", async () => {
        fixture.billing = true
        await mount()

        expect(title()).toBeUndefined()
    })

    it("does not show while the account is still in onboarding", async () => {
        fixture.pending = true
        await mount()

        expect(title()).toBeUndefined()
    })
})
