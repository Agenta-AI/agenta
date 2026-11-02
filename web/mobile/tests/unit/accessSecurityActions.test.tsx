// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    canEdit: true,
    slug: "acme" as string | null,
    orgRefetch: vi.fn(),
    domainsRefetch: vi.fn(),
    providersRefetch: vi.fn(),
    domains: [] as Record<string, unknown>[],
    providers: [] as Record<string, unknown>[],
    api: {
        createOrganizationDomain: vi.fn(),
        verifyOrganizationDomain: vi.fn(),
        refreshOrganizationDomainToken: vi.fn(),
        deleteOrganizationDomain: vi.fn(),
        createOrganizationProvider: vi.fn(),
        updateOrganizationProvider: vi.fn(),
        testOrganizationProvider: vi.fn(),
        deleteOrganizationProvider: vi.fn(),
        fetchOrganizationDomains: vi.fn(),
        fetchOrganizationProviders: vi.fn(),
        updateOrganizationSlug: vi.fn(),
    },
    updateOrganization: vi.fn(),
}))

vi.mock("../../src/features/context/useProjectPermission", () => ({
    useProjectPermission: (_projectId: string, action: string) =>
        action === "edit_workspace" && fixture.canEdit,
}))

vi.mock("../../src/features/settings/settingsTabs", () => ({
    useMobileSettingsAccess: () => ({isEE: true}),
}))

vi.mock("../../src/features/settings/useSettingsOrg", () => ({
    useSettingsOrg: () => ({
        organizationId: "org-1",
        loading: false,
        failed: false,
        retry: vi.fn(),
        org: {
            data: {
                slug: fixture.slug,
                flags: {
                    allow_email: true,
                    allow_social: true,
                    allow_sso: false,
                    auto_join: false,
                    domains_only: false,
                    allow_root: false,
                },
            },
            refetch: fixture.orgRefetch,
        },
    }),
}))

vi.mock("@agenta/entities/organization", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    organizationAccessApi: fixture.api,
    updateOrganization: fixture.updateOrganization,
}))

vi.mock("@agenta/settings-ui", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useEntitlements: () => ({
        hasAccessControl: true,
        hasDomains: true,
        hasSSO: true,
        hasRBAC: true,
        hasHooks: true,
        hasAudit: true,
        isLoading: false,
    }),
}))

vi.mock("@tanstack/react-query", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useQuery: ({queryKey}: {queryKey: unknown[]}) =>
        queryKey[0] === "organization-domains"
            ? {
                  data: fixture.domains,
                  isPending: false,
                  refetch: fixture.domainsRefetch,
              }
            : {
                  data: fixture.providers,
                  isPending: false,
                  refetch: fixture.providersRefetch,
              },
}))

import {AccessSecurityTab} from "@/features/settings/AccessSecurityTab"

const buttons = () =>
    Array.from(document.querySelectorAll("button")).map((button) => button.textContent?.trim())
const button = (label: string) =>
    Array.from(document.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === label,
    )
const dialogButton = (label: string) => {
    const dialog = document.querySelector("[role=dialog]")
    if (!dialog) return undefined
    return Array.from(dialog.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === label,
    )
}

describe("AccessSecurityTab actions", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        fixture.canEdit = true
        fixture.slug = "acme"
        fixture.domains = [
            {
                id: "dom-1",
                slug: "example.com",
                token: "token-1",
                flags: {is_verified: false},
                created_at: new Date().toISOString(),
            },
        ]
        fixture.providers = [
            {id: "prov-1", slug: "okta", flags: {is_active: false, is_valid: false}},
        ]
        Object.values(fixture.api).forEach((fn) => fn.mockReset())
        fixture.api.createOrganizationDomain.mockResolvedValue({})
        fixture.api.verifyOrganizationDomain.mockResolvedValue({})
        fixture.api.createOrganizationProvider.mockResolvedValue({})
        fixture.api.testOrganizationProvider.mockResolvedValue({})
        fixture.domainsRefetch.mockReset().mockResolvedValue(undefined)
        fixture.providersRefetch.mockReset().mockResolvedValue(undefined)
        fixture.orgRefetch.mockReset().mockResolvedValue(undefined)
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const mount = () =>
        act(() => {
            root.render(<AccessSecurityTab workspaceId="ws-1" projectId="proj-1" />)
        })

    it("renders no write affordances without edit_workspace", () => {
        fixture.canEdit = false
        mount()

        expect(buttons()).not.toContain("Add domain")
        expect(buttons()).not.toContain("Add provider")
        expect(buttons()).not.toContain("Verify")
        expect(buttons()).not.toContain("Enable")
        expect(buttons()).not.toContain("Save slug")
    })

    it("adds a domain through the package client and refetches", async () => {
        mount()

        act(() => button("Add domain")!.click())
        const input = document.querySelector("input") as HTMLInputElement
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
            setter?.call(input, "  example.org  ")
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await act(async () => {
            dialogButton("Add domain")!.click()
        })

        expect(fixture.api.createOrganizationDomain).toHaveBeenCalledWith("proj-1", {
            domain: "example.org",
        })
        expect(fixture.domainsRefetch).toHaveBeenCalled()
    })

    it("verifies a pending domain and keeps the row on a backend failure", async () => {
        fixture.api.verifyOrganizationDomain.mockRejectedValue(new Error("DNS record not found"))
        mount()

        await act(async () => {
            button("Verify")!.click()
        })

        expect(fixture.api.verifyOrganizationDomain).toHaveBeenCalledWith("proj-1", "dom-1")
        expect(document.querySelector("[role=alert]")?.textContent).toBe(
            "Could not verify the domain",
        )
        expect(document.body.textContent).toContain("example.com")
    })

    it("enables an invalid provider through the connection test", async () => {
        mount()

        await act(async () => {
            button("Enable")!.click()
        })

        expect(fixture.api.testOrganizationProvider).toHaveBeenCalledWith("proj-1", "prov-1")
        expect(fixture.providersRefetch).toHaveBeenCalled()
    })

    it("tells the user when the connection test does not validate the provider", async () => {
        fixture.api.testOrganizationProvider.mockResolvedValue({flags: {is_valid: false}})
        mount()

        await act(async () => {
            button("Enable")!.click()
        })

        expect(document.querySelector("[role=alert]")?.textContent).toContain(
            "could not connect to the provider",
        )
    })

    it("activates a valid inactive provider without testing it again", async () => {
        fixture.providers = [
            {id: "prov-1", slug: "okta", flags: {is_active: false, is_valid: true}},
        ]
        mount()

        await act(async () => {
            button("Enable")!.click()
        })

        expect(fixture.api.updateOrganizationProvider).toHaveBeenCalledWith("proj-1", "prov-1", {
            flags: {is_active: true},
        })
        expect(fixture.api.testOrganizationProvider).not.toHaveBeenCalled()
    })

    it("blocks adding a provider until the organization has a slug", () => {
        fixture.slug = null
        mount()

        const add = button("Add provider") as HTMLButtonElement
        expect(add.disabled).toBe(true)
        expect(document.body.textContent).toContain(
            "Set an organization slug before adding a provider",
        )
    })

    it("saves a missing slug and refetches the organization and providers", async () => {
        fixture.slug = null
        mount()

        const input = document.querySelector("input") as HTMLInputElement
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
            setter?.call(input, "new-slug")
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await act(async () => {
            button("Save slug")!.click()
        })

        expect(fixture.api.updateOrganizationSlug).toHaveBeenCalledWith("org-1", "new-slug")
        expect(fixture.orgRefetch).toHaveBeenCalled()
        expect(fixture.providersRefetch).toHaveBeenCalled()
    })
})
