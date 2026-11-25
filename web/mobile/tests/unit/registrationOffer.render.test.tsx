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

import {RegistrationOffer} from "@/features/onboarding/RegistrationOffer"
import {isLargeCompany, shouldOfferRegistration} from "@/features/onboarding/registrationOfferRules"
import {registrationSurvey} from "@/features/onboarding/registrationSurvey"

import {WithQueryClient} from "../support/queryClient"

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

    it("sends the chosen labels only, never the typed Other line", () => {
        expect(
            registrationSurvey({
                persona: "Other: Chief tinkerer",
                size: "11-50",
                source: "Other: a podcast",
            }),
        ).toEqual({role: "Other", team_size: "11-50", heard_from: "Other"})
        expect(registrationSurvey({size: "Solo", unknown: "x"})).toEqual({team_size: "Solo"})
        expect(registrationSurvey({persona: "Not a choice"})).toEqual({})
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

    const SURVEY = {role: "Marketing", team_size: "11-50", heard_from: "GitHub"}

    const mount = async ({
        largeCompany = false,
        survey = SURVEY as typeof SURVEY | undefined,
    } = {}) => {
        const onSkip = vi.fn()
        const onDone = vi.fn()
        await act(async () => {
            root.render(
                <WithQueryClient>
                    <RegistrationOffer
                        projectId="proj-1"
                        email="ada@example.com"
                        survey={survey}
                        largeCompany={largeCompany}
                        onSkip={onSkip}
                        onDone={onDone}
                    />
                </WithQueryClient>,
            )
        })
        return {onSkip, onDone}
    }
    const button = (label: string) =>
        Array.from(document.querySelectorAll("button")).find(
            (node) => node.textContent?.trim() === label,
        )
    const text = () => document.body.textContent ?? ""

    it("names the gain, fills in the email, and leaves out the Enterprise line for a small team", async () => {
        await mount()

        expect(document.querySelector("h1")?.textContent).toBe("Register this instance for free")
        expect(text()).toContain(
            "Unlimited projects. Without a key, each organization has 1 project.",
        )
        expect(text()).toContain("New free features.")
        expect(text()).toContain("Security notices.")
        expect(document.querySelector<HTMLInputElement>("input[type=email]")?.value).toBe(
            "ada@example.com",
        )
        expect(text()).toContain("You keep what your key unlocks.")
        expect(text()).not.toContain("Talk to us about Enterprise")
    })

    it("says the setup answers go with the email", async () => {
        await mount()

        expect(text()).toContain(
            "We save your setup answers (role, team size, how you found Agenta) with your email, so our updates fit your setup.",
        )
    })

    it("shows the Enterprise line for a larger company", async () => {
        await mount({largeCompany: true})

        expect(text()).toContain("Talk to us about Enterprise")
    })

    it("skips on Skip", async () => {
        const {onSkip} = await mount()

        act(() => button("Skip")!.click())

        expect(onSkip).toHaveBeenCalledOnce()
        expect(fixture.register).not.toHaveBeenCalled()
    })

    it("ticks the updates box to start, and registers with the answers", async () => {
        const {onDone} = await mount()

        const updates = document.querySelector<HTMLElement>("[role=checkbox]")!
        expect(updates.getAttribute("aria-checked")).toBe("true")
        await act(async () => {
            button("Send me a free key")!.click()
        })

        expect(fixture.register).toHaveBeenCalledWith("proj-1", {
            email: "ada@example.com",
            productUpdates: true,
            survey: SURVEY,
        })
        expect(text()).toContain("We sent a key to ada@example.com.")
        act(() => button("Continue")!.click())
        expect(onDone).toHaveBeenCalledOnce()
    })

    it("still registers when the updates box is cleared", async () => {
        await mount()

        act(() => document.querySelector<HTMLElement>("[role=checkbox]")!.click())
        await act(async () => {
            button("Send me a free key")!.click()
        })

        expect(fixture.register).toHaveBeenCalledWith(
            "proj-1",
            expect.objectContaining({productUpdates: false}),
        )
    })

    it("says the email is not valid when the API refuses it, with no retry prompt", async () => {
        fixture.register.mockReset().mockRejectedValue({response: {status: 422}})
        await mount()

        await act(async () => {
            button("Send me a free key")!.click()
        })

        await vi.waitFor(() =>
            expect(document.querySelector("[role=alert]")?.textContent).toBe(
                "Enter a valid email address.",
            ),
        )
        expect(document.querySelector("input[type=email]")?.getAttribute("aria-invalid")).toBe(
            "true",
        )
        expect(text()).not.toContain("Try again")
    })
})
