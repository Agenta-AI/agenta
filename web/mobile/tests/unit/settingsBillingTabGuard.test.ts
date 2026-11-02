import {beforeEach, describe, expect, it, vi} from "vitest"

const env = vi.hoisted(() => ({
    ee: true,
    billing: false,
    path: "/settings?tab=billing",
    allowed: true,
    pending: false,
    owner: true,
}))

vi.mock("react", () => ({useMemo: (fn: () => unknown) => fn()}))
vi.mock("next/router", () => ({useRouter: () => ({query: {}, asPath: env.path})}))
vi.mock("@agenta/shared/api", () => ({
    isBillingEnabled: () => env.billing,
    isEE: () => env.ee,
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
} from "../../src/features/settings/settingsTabs"

beforeEach(() => {
    env.allowed = true
    env.pending = false
    env.owner = true
    env.ee = true
    env.billing = false
    env.path = "/settings?tab=billing"
})

describe("billing settings tab behind a deep link", () => {
    it("opens the usage page on EE with billing off", () => {
        expect(useActiveSettingsTab()).toBe("billing")
    })

    it("opens the usage and billing page on EE with billing on", () => {
        env.billing = true
        expect(useActiveSettingsTab()).toBe("billing")
    })

    it("falls back to the default tab on OSS", () => {
        env.ee = false
        expect(useActiveSettingsTab()).toBe(DEFAULT_MOBILE_SETTINGS_TAB)
    })
})
