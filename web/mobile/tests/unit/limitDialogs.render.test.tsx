// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class {
    observe = () => undefined
    unobserve = () => undefined
    disconnect = () => undefined
} as unknown as typeof ResizeObserver

const fixture = vi.hoisted(() => ({
    isInstanceAdmin: true,
    usage: null as unknown,
}))

vi.mock("next/router", async () => (await import("../support/nextRouter")).nextRouterModule)

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    isBillingEnabled: () => false,
}))

vi.mock("@agenta/entities/profile", () => ({
    useProfile: () => ({user: {id: "user-1", email: "admin@example.com"}}),
}))

vi.mock("../../src/features/settings/useInstanceLicense", () => ({
    useInstanceLicense: () => ({isInstanceAdmin: fixture.isInstanceAdmin}),
}))

vi.mock("../../src/features/settings/useLicenseUsage", () => ({
    useLicenseUsage: () => ({data: fixture.usage}),
}))

import {NoOrganization} from "@/features/context/NoOrganization"
import {OrganizationLimitNotice} from "@/features/limits/OrganizationLimitNotice"
import {ProjectLimitNotice} from "@/features/limits/ProjectLimitNotice"
import {isAtLimit} from "@/features/settings/licenseApi"
import {NameDialog} from "@/features/settings/NameDialog"
import {ProjectsUsageNotice} from "@/features/settings/ProjectsUsageNotice"

import {routerPush} from "../support/nextRouter"
import {WithQueryClient} from "../support/queryClient"

const FULL = {count: 1, limit: 1}

describe("isAtLimit", () => {
    it("is true only at or above a set limit", () => {
        expect(isAtLimit({count: 1, limit: 1})).toBe(true)
        expect(isAtLimit({count: 2, limit: 1})).toBe(true)
        expect(isAtLimit({count: 0, limit: 1})).toBe(false)
        expect(isAtLimit({count: 9, limit: null})).toBe(false)
        expect(isAtLimit(null)).toBe(false)
    })
})

describe("limit screens", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        fixture.isInstanceAdmin = true
        fixture.usage = null
        routerPush.mockClear()
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const mount = (node: React.ReactNode) =>
        act(() => root.render(<WithQueryClient>{node}</WithQueryClient>))
    const text = () => document.body.textContent ?? ""
    const button = (label: string) =>
        Array.from(document.querySelectorAll<HTMLElement>("button, a")).find(
            (node) => node.textContent?.trim() === label,
        )

    it("shows the project limit on open, with Create off, and registers in place", () => {
        mount(
            <NameDialog
                open
                title="New project"
                submitLabel="Create"
                pending={false}
                submitDisabled
                notice={<ProjectLimitNotice usage={FULL} projectId="proj-1" />}
                onClose={() => undefined}
                onSubmit={() => undefined}
            />,
        )

        expect(text()).toContain("Projects in this organization")
        expect(text()).toContain("1 of 1")
        expect(text()).toContain("Register this instance for free to create more projects.")
        expect(document.querySelector("[role=progressbar]")).not.toBeNull()
        expect(button("Create")?.hasAttribute("disabled")).toBe(true)

        act(() => button("Register this instance")!.click())
        expect(text()).toContain("Register to create more projects")
        expect(routerPush).not.toHaveBeenCalled()
    })

    it("names the count and the limit when an upgraded install is over the limit", () => {
        mount(<ProjectLimitNotice usage={{count: 2, limit: 1}} projectId="proj-1" />)
        expect(text()).toContain("2 projects, limit 1")
        expect(text()).not.toContain("2 of 1")
    })

    it("uses the singular when one organization is over a limit of zero", () => {
        mount(
            <OrganizationLimitNotice
                usage={{count: 1, limit: 0}}
                workspaceId="ws-1"
                projectId="proj-1"
            />,
        )
        expect(text()).toContain("1 organization, limit 0")
    })

    it("names the organization count and the limit when over the limit", () => {
        mount(
            <OrganizationLimitNotice
                usage={{count: 2, limit: 1}}
                workspaceId="ws-1"
                projectId="proj-1"
            />,
        )
        expect(text()).toContain("2 organizations, limit 1")
        expect(text()).not.toContain("2 of 1")
    })

    it("asks a member to ask the instance admin, with no button", () => {
        fixture.isInstanceAdmin = false
        mount(<ProjectLimitNotice usage={FULL} projectId="proj-1" />)

        expect(text()).toContain(
            "Ask your instance admin to register this instance for more projects.",
        )
        expect(button("Register this instance")).toBeUndefined()
    })

    it("shows the organization limit with no free key pointer", () => {
        const onNavigate = vi.fn()
        mount(
            <OrganizationLimitNotice
                usage={FULL}
                workspaceId="ws-1"
                projectId="proj-1"
                onNavigate={onNavigate}
            />,
        )

        expect(text()).toContain("Organizations on this instance")
        expect(text()).toContain("A second organization needs an Enterprise license.")
        expect(text()).not.toContain("free")
        expect(button("Talk to us")).toBeDefined()
        act(() => button("Add a license key")!.click())
        expect(onNavigate).toHaveBeenCalledOnce()
        expect(routerPush).toHaveBeenCalledWith("/w/ws-1/p/proj-1/settings?tab=license")
    })

    it("offers a member only Talk to us at the organization limit", () => {
        fixture.isInstanceAdmin = false
        mount(<OrganizationLimitNotice usage={FULL} workspaceId="ws-1" projectId="proj-1" />)

        expect(button("Add a license key")).toBeUndefined()
        expect(button("Talk to us")).toBeDefined()
    })

    it("shows the project usage on Settings, Projects for an instance with no key", () => {
        fixture.usage = {projects: FULL, organizations: FULL}
        mount(<ProjectsUsageNotice projectId="proj-1" />)

        expect(text()).toContain(
            "This organization uses 1 of 1 projects. Register this instance for free to create more.",
        )
        act(() => button("Register")!.click())
        expect(text()).toContain("Register to create more projects")
    })

    it("names the count and the limit on Settings, Projects when over the limit", () => {
        fixture.usage = {projects: {count: 2, limit: 1}, organizations: FULL}
        mount(<ProjectsUsageNotice projectId="proj-1" />)

        expect(text()).toContain(
            "This organization uses 2 projects, limit 1. Register this instance for free to create more.",
        )
    })

    it("hides the project usage without a limit, or from a member", () => {
        fixture.usage = {projects: {count: 3, limit: null}, organizations: FULL}
        mount(<ProjectsUsageNotice projectId="proj-1" />)
        expect(text()).toBe("")

        fixture.usage = {projects: FULL, organizations: FULL}
        fixture.isInstanceAdmin = false
        mount(<ProjectsUsageNotice projectId="proj-1" />)
        expect(text()).toBe("")
    })

    it("names who to ask and the signed-in account when there is no organization", () => {
        const onCheckAgain = vi.fn()
        const onSignOut = vi.fn()
        mount(<NoOrganization onCheckAgain={onCheckAgain} onSignOut={onSignOut} />)

        expect(text()).toContain("You are not in an organization yet")
        expect(text()).toContain("Ask its admin to invite you.")
        expect(text()).toContain("Signed in as admin@example.com")
        act(() => button("Check again")!.click())
        act(() => button("Sign out")!.click())
        expect(onCheckAgain).toHaveBeenCalledOnce()
        expect(onSignOut).toHaveBeenCalledOnce()
    })
})
