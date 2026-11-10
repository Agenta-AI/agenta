// @vitest-environment jsdom
import {act, StrictMode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    edition: "oss" as "oss" | "ee" | "cloud",
    capture: vi.fn(),
    replace: vi.fn(),
    api: {
        fetchOrganizationDomains: vi.fn(),
        fetchOrganizationProviders: vi.fn(),
    },
}))

vi.mock("next/router", () => ({
    useRouter: () => ({...nextRouterModule.useRouter(), replace: fixture.replace}),
}))

vi.mock("@/features/analytics/client", () => ({capture: fixture.capture}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    isEE: () => fixture.edition !== "oss",
    isBillingEnabled: () => fixture.edition === "cloud",
}))

vi.mock("../../src/features/settings/settingsTabs", () => ({
    useMobileSettingsAccess: () => ({isEE: fixture.edition !== "oss"}),
}))

vi.mock("../../src/features/context/useProjectPermission", () => ({
    useProjectPermission: () => true,
}))

vi.mock("../../src/features/settings/useSettingsOrg", () => ({
    useSettingsOrg: () => ({
        organizationId: "org-1",
        loading: false,
        failed: false,
        retry: vi.fn(),
        org: {data: {slug: "acme", flags: {}, default_workspace: {members: []}}},
    }),
}))

vi.mock("@agenta/entities/profile", () => ({useProfile: () => ({user: {id: "user-1"}})}))

vi.mock("@agenta/entities/organization", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    organizationAccessApi: fixture.api,
}))

vi.mock("@agenta/settings-ui", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    // The plan includes none of the enterprise features.
    useEntitlements: () => ({
        hasAccessControl: false,
        hasDomains: false,
        hasSSO: false,
        hasRBAC: false,
        hasHooks: false,
        hasAudit: false,
        isLoading: false,
    }),
}))

import {nextRouterModule, routerQuery} from "../support/nextRouter"
import {WithQueryClient} from "../support/queryClient"

import {AccessSecurityTab} from "@/features/settings/AccessSecurityTab"
import {AuditLogTab} from "@/features/settings/AuditLogTab"
import {availableUpgradeActions} from "@/features/settings/upgradePrompt"

const labels = () =>
    Array.from(document.querySelectorAll("button, a")).map((node) => node.textContent?.trim())
const control = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>("button, a")).find(
        (node) => node.textContent?.trim() === label,
    )
const events = (name: string) =>
    fixture.capture.mock.calls.filter(([event]) => event === name).map(([, props]) => props)

describe("locked enterprise settings", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        fixture.edition = "oss"
        fixture.capture.mockReset()
        fixture.replace.mockReset()
        fixture.api.fetchOrganizationDomains.mockReset()
        fixture.api.fetchOrganizationProviders.mockReset()
        routerQuery.tab = undefined
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const mount = async (node: React.ReactNode) => {
        await act(async () => {
            root.render(<WithQueryClient>{node}</WithQueryClient>)
        })
    }

    it("shows Audit Log as locked on OSS, with the upgrade docs and the contact page", async () => {
        await mount(<AuditLogTab workspaceId="ws-1" projectId="proj-1" />)

        expect(document.body.textContent).toContain("Audit Log is not available on your plan")
        expect(document.body.textContent).toContain("Available with an Enterprise license.")
        expect(labels()).toEqual(expect.arrayContaining(["How to upgrade", "Talk to us"]))
        expect(labels()).not.toContain("Add a license key")
        expect(control("Talk to us")?.getAttribute("href")).toBe(
            "https://agenta.ai/contact?feature=audit",
        )
        expect(events("upgrade_prompt_viewed")).toEqual([{feature: "audit", screen: "auditLog"}])
    })

    it("sends upgrade_prompt_viewed once per view under StrictMode", async () => {
        // As Next.js does with reactStrictMode: StrictMode wraps the root.
        await act(async () => {
            root.render(
                <StrictMode>
                    <WithQueryClient>
                        <AuditLogTab workspaceId="ws-1" projectId="proj-1" />
                    </WithQueryClient>
                </StrictMode>,
            )
        })

        expect(events("upgrade_prompt_viewed")).toEqual([{feature: "audit", screen: "auditLog"}])
    })

    it("sends upgrade_prompt_clicked with the action", async () => {
        await mount(<AuditLogTab workspaceId="ws-1" projectId="proj-1" />)

        act(() => control("How to upgrade")!.click())

        expect(events("upgrade_prompt_clicked")).toEqual([
            {feature: "audit", screen: "auditLog", action: "upgrade_docs"},
        ])
    })

    it("shows each Access & Security feature as locked on OSS and calls none of their routes", async () => {
        await mount(<AccessSecurityTab workspaceId="ws-1" projectId="proj-1" />)

        expect(events("upgrade_prompt_viewed")).toEqual([
            {feature: "access", screen: "organization"},
            {feature: "domains", screen: "organization"},
            {feature: "sso", screen: "organization"},
        ])
        expect(labels().filter((label) => label === "Talk to us")).toHaveLength(3)
        expect(fixture.api.fetchOrganizationDomains).not.toHaveBeenCalled()
        expect(fixture.api.fetchOrganizationProviders).not.toHaveBeenCalled()
    })

    it("offers Add a license key on EE without a key, which opens the License tab", async () => {
        fixture.edition = "ee"
        await mount(<AccessSecurityTab workspaceId="ws-1" projectId="proj-1" />)

        expect(labels()).toContain("Add a license key")
        expect(labels()).not.toContain("How to upgrade")
        expect(labels()).not.toContain("Get a free key")

        act(() => control("Add a license key")!.click())

        expect(fixture.replace).toHaveBeenCalledWith(
            expect.objectContaining({query: expect.objectContaining({tab: "license"})}),
            undefined,
            {shallow: true},
        )
        expect(events("upgrade_prompt_clicked")[0]).toEqual({
            feature: "access",
            screen: "organization",
            action: "add_license_key",
        })
        expect(fixture.api.fetchOrganizationDomains).not.toHaveBeenCalled()
    })

    it("keeps the cloud plan notice and sends no upgrade events on cloud", async () => {
        fixture.edition = "cloud"
        await mount(<AuditLogTab workspaceId="ws-1" projectId="proj-1" />)

        expect(document.body.textContent).toContain("Available on Business and Enterprise plans.")
        expect(labels()).not.toContain("Talk to us")
        expect(fixture.capture).not.toHaveBeenCalled()
    })
})

describe("availableUpgradeActions", () => {
    it("offers a license key on EE and the upgrade docs on OSS, then the contact page", () => {
        expect(availableUpgradeActions(true)).toEqual(["add_license_key", "talk_to_us"])
        expect(availableUpgradeActions(false)).toEqual(["upgrade_docs", "talk_to_us"])
    })
})
