import {beforeEach, describe, expect, it, vi} from "vitest"

const env = vi.hoisted(() => ({ee: true, path: "/settings?tab=credits"}))

vi.mock("react", () => ({useMemo: (fn: () => unknown) => fn()}))
vi.mock("next/router", () => ({useRouter: () => ({query: {}, asPath: env.path})}))
vi.mock("@agenta/shared/api", () => ({
    isBillingEnabled: () => true,
    isEE: () => env.ee,
    isMcpGatewayEnabled: () => true,
    isToolsEnabled: () => true,
    isWalletsEnabled: () => true,
}))
vi.mock("../../src/features/wallet/useWalletSummary", () => ({
    useWalletSummary: () => ({data: {mode: "enforce"}}),
}))

import {
    DEFAULT_MOBILE_SETTINGS_TAB,
    useActiveSettingsTab,
} from "../../src/features/settings/settingsTabs"

beforeEach(() => {
    env.ee = true
})

describe("wallet settings tabs behind a deep link", () => {
    it.each(["credits", "walletUsage"])("open %s on EE", (tab) => {
        env.path = `/settings?tab=${tab}`
        expect(useActiveSettingsTab()).toBe(tab)
    })

    it.each(["credits", "walletUsage"])(
        "fall back to the default tab for %s on OSS, even with the wallet flag on",
        (tab) => {
            env.ee = false
            env.path = `/settings?tab=${tab}`
            expect(useActiveSettingsTab()).toBe(DEFAULT_MOBILE_SETTINGS_TAB)
        },
    )
})
