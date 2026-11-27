import {beforeEach, describe, expect, it, vi} from "vitest"

const env = vi.hoisted(() => ({
    path: "/settings?tab=analytics",
    allowed: true,
    pending: false,
    owner: true,
    profilePending: false,
    billing: true,
    wallets: false,
    walletSummary: undefined as {mode: string} | undefined,
}))

vi.mock("react", () => ({useMemo: (fn: () => unknown) => fn()}))
vi.mock("next/router", () => ({useRouter: () => ({query: {}, asPath: env.path})}))
vi.mock("@agenta/shared/api", () => ({
    isBillingEnabled: () => env.billing,
    isMcpGatewayEnabled: () => true,
    isToolsEnabled: () => true,
    isWalletsEnabled: () => env.wallets,
}))
vi.mock("../../src/features/context/useProjectPermission", () => ({
    useProjectPermission: () => env.allowed,
    useProjectPermissionState: () => ({allowed: env.allowed, pending: env.pending}),
}))
vi.mock("@agenta/entities/profile", () => ({
    useProfile: () =>
        env.profilePending
            ? {user: null, isPending: true}
            : {user: {id: "person-1"}, isPending: false},
}))
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
vi.mock("../../src/features/settings/useInstanceLicense", () => ({
    useInstanceLicense: () => ({isInstanceAdmin: false}),
}))
vi.mock("../../src/features/wallet/useWalletSummary", () => ({
    useWalletSummary: () => ({data: env.walletSummary}),
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
    env.profilePending = false
    env.billing = true
    env.wallets = false
    env.walletSummary = undefined
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

    it("holds Access & Security while the profile is still loading", () => {
        env.path = "/settings?tab=organization"
        env.profilePending = true
        expect(useActiveSettingsTab()).toBe("organization")
    })

    it("keeps the plan page readable for every role", () => {
        env.path = "/settings?tab=billing"
        env.allowed = false
        env.owner = false
        expect(useActiveSettingsTab()).toBe("billing")
        expect(useMobileSettingsAccess().canViewBilling).toBe(true)
    })
})

describe("billing settings tab behind a deep link", () => {
    it("opens the usage page on a self-hosted install (billing off)", () => {
        env.path = "/settings?tab=billing"
        env.billing = false
        expect(useActiveSettingsTab()).toBe("billing")
    })
})

describe("wallet settings tabs behind a deep link", () => {
    beforeEach(() => {
        env.wallets = true
        env.walletSummary = {mode: "enforce"}
    })

    it.each(["credits", "walletUsage"])("open Credits for %s with the wallet flag on", (tab) => {
        env.path = `/settings?tab=${tab}`
        expect(useActiveSettingsTab()).toBe("credits")
    })

    it.each(["credits", "walletUsage"])(
        "fall back to the default tab for %s with the wallet flag off",
        (tab) => {
            env.wallets = false
            env.path = `/settings?tab=${tab}`
            expect(useActiveSettingsTab()).toBe(DEFAULT_MOBILE_SETTINGS_TAB)
        },
    )
})
