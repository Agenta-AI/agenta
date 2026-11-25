// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({cloud: false, isInstanceAdmin: false}))

vi.mock("next/router", async () => (await import("../support/nextRouter")).nextRouterModule)

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    isBillingEnabled: () => fixture.cloud,
}))

vi.mock("@agenta/entities/profile", () => ({
    useProfile: () => ({user: {id: "user-1", email: "admin@example.com"}}),
}))

// Radix measures its controls; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
    observe = () => undefined
    unobserve = () => undefined
    disconnect = () => undefined
} as unknown as typeof ResizeObserver

vi.mock("../../src/features/settings/useInstanceLicense", () => ({
    useInstanceLicense: () => ({isInstanceAdmin: fixture.isInstanceAdmin}),
}))

import {readLimitRefusal, type LimitRefusal} from "@/features/limits/limitRefusal"
import {LimitRefusalNotice} from "@/features/limits/LimitRefusalNotice"

import {routerPush} from "../support/nextRouter"
import {WithQueryClient} from "../support/queryClient"

const PROJECT: LimitRefusal = {code: "project_limit_reached", limit: 1}
const ORGANIZATION: LimitRefusal = {code: "instance_organization_limit_reached", limit: 1}

const apiError = (detail: unknown) => ({response: {status: 403, data: {detail}}})

describe("readLimitRefusal", () => {
    it("reads both limit codes from detail.code", () => {
        expect(
            readLimitRefusal(apiError({code: "project_limit_reached", message: "m", limit: 1})),
        ).toEqual(PROJECT)
        expect(
            readLimitRefusal(
                apiError({code: "instance_organization_limit_reached", message: "m", limit: 3}),
            ),
        ).toEqual({code: "instance_organization_limit_reached", limit: 3})
    })

    it("leaves every other error to the string fallback", () => {
        expect(readLimitRefusal(apiError("You are not allowed"))).toBeNull()
        expect(readLimitRefusal(apiError({code: "run_credential_required"}))).toBeNull()
        expect(readLimitRefusal(new Error("network"))).toBeNull()
        expect(readLimitRefusal(null)).toBeNull()
    })
})

describe("LimitRefusalNotice", () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
        fixture.cloud = false
        fixture.isInstanceAdmin = false
        routerPush.mockClear()
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const render = (refusal: LimitRefusal, onNavigate = vi.fn()) => {
        act(() =>
            root.render(
                <WithQueryClient>
                    <LimitRefusalNotice
                        refusal={refusal}
                        workspaceId="ws-1"
                        projectId="proj-1"
                        onNavigate={onNavigate}
                    />
                </WithQueryClient>,
            ),
        )
        return onNavigate
    }
    const button = (label: string) =>
        Array.from(document.querySelectorAll<HTMLElement>("button, a")).find(
            (node) => node.textContent?.trim() === label,
        )

    it("shows the instance admin the project limit notice of the open dialog", () => {
        fixture.isInstanceAdmin = true
        const onNavigate = render({...PROJECT, limit: 3})

        expect(container.textContent).toContain("Projects in this organization")
        expect(container.textContent).toContain("3 of 3")
        expect(container.textContent).toContain(
            "Register this instance for free to create more projects.",
        )
        act(() => button("Register this instance")!.click())
        expect(onNavigate).not.toHaveBeenCalled()
        expect(routerPush).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain("Register to create more projects")
    })

    it("asks a member to ask the instance admin at the project limit, with no button", () => {
        render(PROJECT)

        expect(container.textContent).toContain(
            "Ask your instance admin to register this instance for more projects.",
        )
        expect(button("Register this instance")).toBeUndefined()
    })

    it("shows the organization limit notice of the open dialog", () => {
        fixture.isInstanceAdmin = true
        const onNavigate = render(ORGANIZATION)

        expect(container.textContent).toContain("Organizations on this instance")
        expect(container.textContent).toContain("1 of 1")
        expect(container.textContent).toContain(
            "A second organization needs an Enterprise license.",
        )
        act(() => button("Add a license key")!.click())
        expect(onNavigate).toHaveBeenCalledOnce()
        expect(routerPush).toHaveBeenCalledWith("/w/ws-1/p/proj-1/settings?tab=license")
    })

    it("offers a member only Talk to us at the organization limit", () => {
        render(ORGANIZATION)

        expect(button("Talk to us")).toBeDefined()
        expect(button("Add a license key")).toBeUndefined()
    })

    it("keeps the upgrade path to Billing on cloud", () => {
        fixture.cloud = true
        const onNavigate = render(PROJECT)

        expect(container.textContent).toContain(
            "The Hobby plan includes 1 project. Upgrade to Starter for unlimited projects.",
        )
        act(() => button("Upgrade plan")!.click())
        expect(onNavigate).toHaveBeenCalledOnce()
        expect(routerPush).toHaveBeenCalledWith("/w/ws-1/p/proj-1/settings?tab=billing")
    })
})
