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

vi.mock("../../src/features/settings/useInstanceLicense", () => ({
    useInstanceLicense: () => ({isInstanceAdmin: fixture.isInstanceAdmin}),
}))

import {
    limitNextStep,
    limitRefusalText,
    readLimitRefusal,
    type LimitRefusal,
} from "@/features/limits/limitRefusal"
import {LimitRefusalNotice} from "@/features/limits/LimitRefusalNotice"

import {routerPush} from "../support/nextRouter"

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

describe("limitRefusalText", () => {
    it("asks the instance admin to register the instance on a self-hosted project refusal", () => {
        expect(limitRefusalText(PROJECT, {cloud: false, isInstanceAdmin: true})).toBe(
            "This organization has reached its limit of 1 project. Register this instance for free to create more projects.",
        )
    })

    it("keeps the free key sentence for a member", () => {
        expect(limitRefusalText(PROJECT, {cloud: false, isInstanceAdmin: false})).toBe(
            "This organization has reached its limit of 1 project. A free key gives more projects.",
        )
    })

    it("keeps the Hobby plan text on cloud", () => {
        expect(limitRefusalText(PROJECT, {cloud: true, isInstanceAdmin: true})).toBe(
            "The Hobby plan includes 1 project. Upgrade to Starter for unlimited projects.",
        )
    })

    it("explains the instance organization limit", () => {
        expect(limitRefusalText(ORGANIZATION, {cloud: false, isInstanceAdmin: true})).toBe(
            "This instance allows 1 organization. Ask for an invitation to an existing organization, or add a paid license key.",
        )
    })

    it("uses the plural form above one", () => {
        expect(
            limitRefusalText({...ORGANIZATION, limit: 3}, {cloud: false, isInstanceAdmin: true}),
        ).toBe(
            "This instance allows 3 organizations. Ask for an invitation to an existing organization, or add a paid license key.",
        )
        expect(
            limitRefusalText({...PROJECT, limit: 3}, {cloud: false, isInstanceAdmin: true}),
        ).toBe(
            "This organization has reached its limit of 3 projects. Register this instance for free to create more projects.",
        )
    })
})

describe("limitNextStep", () => {
    it("sends a cloud project refusal to Billing", () => {
        expect(limitNextStep({refusal: PROJECT, cloud: true, isInstanceAdmin: false})).toBe(
            "billing",
        )
    })

    it("sends the instance admin to the License tab, and others to the admin", () => {
        for (const refusal of [PROJECT, ORGANIZATION]) {
            expect(limitNextStep({refusal, cloud: false, isInstanceAdmin: true})).toBe("license")
            expect(limitNextStep({refusal, cloud: false, isInstanceAdmin: false})).toBe("askAdmin")
        }
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
                <LimitRefusalNotice
                    refusal={refusal}
                    workspaceId="ws-1"
                    projectId="proj-1"
                    onNavigate={onNavigate}
                />,
            ),
        )
        return onNavigate
    }
    const button = () => container.querySelector("button")

    it("asks the instance admin to register the instance, with a button to the License tab", () => {
        fixture.isInstanceAdmin = true
        const onNavigate = render(PROJECT)

        expect(container.textContent).toContain(
            "This organization has reached its limit of 1 project. Register this instance for free to create more projects.",
        )
        expect(container.textContent).not.toContain("Ask your instance admin.")
        expect(button()?.textContent).toBe("Register this instance")
        act(() => button()?.click())
        expect(onNavigate).toHaveBeenCalledOnce()
        expect(routerPush).toHaveBeenCalledWith("/w/ws-1/p/proj-1/settings?tab=license")
    })

    it("keeps the License settings button at the organization limit", () => {
        fixture.isInstanceAdmin = true
        render(ORGANIZATION)

        expect(button()?.textContent).toBe("Open License settings")
        act(() => button()?.click())
        expect(routerPush).toHaveBeenCalledWith("/w/ws-1/p/proj-1/settings?tab=license")
    })

    it("keeps the member text at the project limit", () => {
        render(PROJECT)

        expect(container.textContent).toBe(
            "This organization has reached its limit of 1 project. A free key gives more projects. Ask your instance admin.",
        )
        expect(button()).toBeNull()
    })

    it("tells a member to ask the instance admin, with no button", () => {
        render(ORGANIZATION)

        expect(container.textContent).toContain(
            "This instance allows 1 organization. Ask for an invitation to an existing organization, or add a paid license key. Ask your instance admin.",
        )
        expect(button()).toBeNull()
    })

    it("keeps the upgrade path to Billing on cloud", () => {
        fixture.cloud = true
        render(PROJECT)

        expect(button()?.textContent).toBe("Upgrade plan")
        act(() => button()?.click())
        expect(routerPush).toHaveBeenCalledWith("/w/ws-1/p/proj-1/settings?tab=billing")
    })
})
