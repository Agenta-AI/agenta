import {beforeEach, describe, expect, it, vi} from "vitest"

const env = vi.hoisted(() => ({
    path: "/settings?tab=analytics",
    allowed: true,
    pending: false,
    owner: true,
}))

vi.mock("react", () => ({useMemo: (fn: () => unknown) => fn()}))
vi.mock("next/router", () => ({useRouter: () => ({query: {}, asPath: env.path})}))
vi.mock("@agenta/shared/api", () => ({
    isBillingEnabled: () => true,
    isEE: () => true,
    isMcpGatewayEnabled: () => true,
    isToolsEnabled: () => true,
    isWalletsEnabled: () => false,
}))
vi.mock("../../src/features/context/useProjectPermission", () => ({
    useProjectPermission: () => env.allowed,
    useProjectPermissionState: () => ({allowed: env.allowed, pending: env.pending}),
}))
vi.mock("@agenta/entities/profile", () => ({useProfile: () => ({user: {id: "person-1"}})}))
vi.mock("../../src/features/settings/useSettingsOrg", () => ({
    useSettingsOrg: () => ({
        projects: {data: [], isPending: false, isError: false},
        organizationId: "organization-1",
        org: {data: {owner_id: env.owner ? "person-1" : "someone-else"}, isPending: false},
        loading: false,
        failed: false,
        retry: () => undefined,
    }),
}))
vi.mock("../../src/features/wallet/useWalletSummary", () => ({
    useWalletSummary: () => ({data: undefined}),
}))

import {
    DEFAULT_MOBILE_SETTINGS_TAB,
    useActiveSettingsTab,
    useMobileSettingsAccess,
} from "../../src/features/settings/settingsTabs"

beforeEach(() => {
    env.path = "/settings?tab=analytics"
    env.allowed = true
    env.pending = false
    env.owner = true
})

describe("tabs a role cannot open", () => {
    it("opens Analytics for a reader who may read trace content", () => {
        expect(useActiveSettingsTab()).toBe("analytics")
    })

    it("falls back to the default tab when trace content is refused", () => {
        env.allowed = false
        expect(useActiveSettingsTab()).toBe(DEFAULT_MOBILE_SETTINGS_TAB)
    })

    it("holds Analytics while the check is still in flight", () => {
        env.allowed = false
        env.pending = true
        expect(useActiveSettingsTab()).toBe("analytics")
    })

    it("hides Analytics from the tab list when trace content is refused", () => {
        env.allowed = false
        expect(useMobileSettingsAccess().canViewAnalytics).toBe(false)
    })

    it("opens Access & Security for the organization owner only", () => {
        env.path = "/settings?tab=organization"
        expect(useActiveSettingsTab()).toBe("organization")
        env.owner = false
        expect(useActiveSettingsTab()).toBe(DEFAULT_MOBILE_SETTINGS_TAB)
    })

    it("keeps the plan page readable for every role", () => {
        env.path = "/settings?tab=billing"
        env.allowed = false
        env.owner = false
        expect(useActiveSettingsTab()).toBe("billing")
        expect(useMobileSettingsAccess().canViewBilling).toBe(true)
    })
})
