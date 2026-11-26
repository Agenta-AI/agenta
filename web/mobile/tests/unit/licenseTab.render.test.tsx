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
    edition: "ee" as "oss" | "ee",
    license: null as unknown,
    usage: {projects: null, organizations: null} as unknown,
    fetchUsage: vi.fn(),
    activate: vi.fn(),
}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    isEE: () => fixture.edition === "ee",
    isBillingEnabled: () => false,
}))

vi.mock("@agenta/entities/profile", () => ({
    useProfile: () => ({user: {id: "user-1", email: "admin@example.com"}}),
}))

vi.mock("../../src/features/settings/licenseApi", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchInstanceLicense: async () => fixture.license,
    fetchLicenseUsage: fixture.fetchUsage,
    activateInstanceLicense: fixture.activate,
}))

import {LicenseTab} from "@/features/settings/LicenseTab"

import {WithQueryClient} from "../support/queryClient"

const DAY = 24 * 60 * 60 * 1000

const community = (usage: Record<string, unknown> = {}) => ({
    plan: "self_hosted_community",
    source: null,
    license: null,
    usage: {users: 1, ...usage},
})

const keyOf = (plan: string, fields: Record<string, unknown> = {}) => ({
    key_id: "k-1",
    plan,
    customer: "admin@example.com",
    seats: null,
    issued_at: "2026-11-01T00:00:00Z",
    expires_at: null,
    telemetry: "required",
    ...fields,
})

describe("License tab", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        fixture.edition = "ee"
        fixture.activate.mockReset()
        fixture.usage = {projects: null, organizations: null}
        fixture.fetchUsage.mockReset()
        fixture.fetchUsage.mockImplementation(async () => fixture.usage)
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
                    <LicenseTab workspaceId="ws-1" projectId="proj-1" />
                </WithQueryClient>,
            )
        })
        await vi.waitFor(() => expect(document.querySelector("h3")).not.toBeNull())
    }
    const text = () => document.body.textContent ?? ""
    const button = (label: string) =>
        Array.from(document.querySelectorAll("button, a")).find(
            (node) => node.textContent?.trim() === label,
        ) as HTMLElement | undefined

    it("before a key: the Community plan, the free key card, and the key behind a dialog", async () => {
        fixture.license = community()
        await mount()

        expect(text()).toContain("Community")
        expect(text()).toContain("Free")
        expect(text()).toContain("You are on the free Community plan.")
        expect(text()).toContain("Register this instance for free")
        expect(text()).toContain("Send me a free key")
        expect(text()).toContain("Have a license key?")
        expect(document.querySelector("textarea")).toBeNull()
        // No usage the API did not return.
        expect(text()).not.toContain("Projects in this organization")

        act(() => button("Add a license key")!.click())
        await vi.waitFor(() => expect(document.querySelector("textarea")).not.toBeNull())
    })

    it("shows the project and organization usage with bars from the usage read", async () => {
        fixture.license = community()
        fixture.usage = {projects: {count: 1, limit: 1}, organizations: {count: 1, limit: 1}}
        await mount()

        await vi.waitFor(() => expect(text()).toContain("Projects in this organization"))
        expect(text()).toContain("Organizations on this instance")
        expect(document.querySelectorAll("[role=progressbar]")).toHaveLength(2)
    })

    it("names the count and the limit when an upgraded install is over the limit", async () => {
        fixture.license = community()
        fixture.usage = {projects: {count: 2, limit: 1}, organizations: {count: 3, limit: 1}}
        await mount()

        await vi.waitFor(() => expect(text()).toContain("2 projects, limit 1"))
        expect(text()).toContain("3 organizations, limit 1")
        expect(text()).not.toContain("2 of 1")
    })

    it("after a free key: Community with a Registered badge and the Enterprise offer", async () => {
        fixture.license = {
            plan: "self_hosted_registered",
            source: "database",
            license: keyOf("self_hosted_registered"),
            usage: {users: 2},
        }
        fixture.usage = {projects: {count: 3, limit: null}, organizations: null}
        await mount()
        await vi.waitFor(() => expect(text()).toContain("3 of unlimited"))

        expect(text()).toContain("Registered")
        expect(text()).toContain(
            "Registered to admin@example.com. You get new free features as we add them.",
        )
        expect(text()).toContain("3 of unlimited")
        expect(text()).toContain("Key expires")
        expect(text()).toContain("Never")
        expect(text()).toContain("Need more than one organization, SSO or audit logs?")
        expect(text()).not.toContain("Send me a free key")
        expect(button("Talk to us")).toBeDefined()
    })

    it("after a paid key: seats with a bar, days left, and Replace key", async () => {
        const expires = new Date(Date.now() + 10 * DAY + 60_000).toISOString()
        fixture.license = {
            plan: "self_hosted_enterprise",
            source: "database",
            license: keyOf("self_hosted_enterprise", {
                customer: "Example Inc",
                seats: 10,
                expires_at: expires,
            }),
            usage: {users: 1},
        }
        await mount()

        expect(text()).toContain("Enterprise")
        expect(text()).toContain("Active")
        expect(text()).toContain("Example Inc")
        expect(text()).toContain("1 of 10")
        expect(text()).toContain("(in 11 days)")
        expect(document.querySelectorAll("[role=progressbar]")).toHaveLength(1)
        expect(button("Replace key")).toBeDefined()
    })

    it("says when a free key was issued for another instance", async () => {
        fixture.license = community()
        fixture.activate.mockRejectedValue({
            response: {status: 400, data: {detail: {code: "other_instance"}}},
        })
        await mount()

        act(() => button("Add a license key")!.click())
        await vi.waitFor(() => expect(document.querySelector("textarea")).not.toBeNull())
        const textarea = document.querySelector("textarea")!
        const setValue = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
        )!.set!
        act(() => {
            setValue.call(textarea, "agenta_license_v1.a.b")
            textarea.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await act(async () => {
            button("Add key")!.click()
        })

        await vi.waitFor(() =>
            expect(text()).toContain(
                "This free key was issued for another instance. Register this instance to get its own key.",
            ),
        )
    })

    it("on the OSS image, points to the Enterprise image instead of the key dialog", async () => {
        fixture.edition = "oss"
        fixture.license = community()
        await mount()

        expect(button("Add a license key")).toBeUndefined()
        expect(text()).toContain("License keys need the Enterprise image.")
    })

    it("reads the usage again after a key is added", async () => {
        fixture.license = community()
        fixture.activate.mockResolvedValue({
            ...community(),
            plan: "self_hosted_registered",
            source: "database",
            license: keyOf("self_hosted_registered"),
        })
        await mount()
        await vi.waitFor(() => expect(fixture.fetchUsage).toHaveBeenCalledTimes(1))

        act(() => button("Add a license key")!.click())
        await vi.waitFor(() => expect(document.querySelector("textarea")).not.toBeNull())
        const textarea = document.querySelector("textarea")!
        const setValue = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
        )!.set!
        act(() => {
            setValue.call(textarea, "agenta_license_v1.a.b")
            textarea.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await act(async () => {
            button("Add key")!.click()
        })

        await vi.waitFor(() => expect(fixture.fetchUsage).toHaveBeenCalledTimes(2))
    })
})
