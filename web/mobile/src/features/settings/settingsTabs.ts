import {useMemo} from "react"

import type {SettingsAccess, SettingsTabKey} from "@agenta/settings"
import {
    isBillingEnabled,
    isEE,
    isMcpGatewayEnabled,
    isToolsEnabled,
    isWalletsEnabled,
} from "@agenta/shared/api"
import {useRouter} from "next/router"

import {useWalletSummary} from "../wallet/useWalletSummary"

/** Tabs this app has a page for. The rest are listed nowhere rather than dead-ending. */
export const AVAILABLE_SETTINGS_TABS: SettingsTabKey[] = [
    "llms",
    "tools",
    "secrets",
    "mcpEndpoints",
    "channels",
    "apiKeys",
    "webhooks",
    "analytics",
    "billing",
    "workspace",
    "organizationGeneral",
    "projects",
    "organization",
    "auditLog",
    "credits",
    "walletUsage",
    "account",
    "preferences",
]

/**
 * Read-only host for most tabs: it renders lists but brings none of the create/edit dialogs,
 * so those write affordances stay off. Tools and MCP servers are the exceptions — their
 * sections moved to `@agenta/settings-ui` and carry their own dialogs, so this app renders
 * the same surface the desktop does. View flags are optimistic — the API authorizes regardless, and each page
 * has an empty state — while edition comes from the same env the desktop reads.
 */
export const useMobileSettingsAccess = (): SettingsAccess => {
    // Edition and feature gates come from the shared helpers the desktop uses, so a tab cannot
    // be visible here and hidden there. `isEE()` also accepts the `cloud*` tiers, which a bare
    // `=== "ee"` misses.
    const enterprise = isEE()
    const billingEnabled = isBillingEnabled()
    const toolsEnabled = isToolsEnabled()
    const mcpGatewayEnabled = isMcpGatewayEnabled()
    const walletsEnabled = isWalletsEnabled()
    const router = useRouter()
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    const walletEnforced = useWalletSummary(projectId).data?.mode === "enforce"

    return useMemo(
        () => ({
            // Names the tab "Usage & Billing" rather than "Usage" — this surface can now change
            // a subscription, not only report against one.
            billingEnabled,
            canShowMcpEndpoints: mcpGatewayEnabled,
            canShowTools: toolsEnabled,
            canViewApiKeys: true,
            canViewEvents: true,
            isEE: enterprise,
            // Owner-gated tabs (Access & Security, Usage) list themselves optimistically like
            // every other view flag here — their pages are read-only and the API authorizes.
            isOwner: true,
            walletsEnabled,
            walletEnforced,
            // The raw wallet data is for developers: it stays out of production builds.
            walletDebug: process.env.NODE_ENV !== "production",
        }),
        [
            enterprise,
            billingEnabled,
            toolsEnabled,
            mcpGatewayEnabled,
            walletsEnabled,
            walletEnforced,
        ],
    )
}

/** Where Settings opens with no `?tab=`, and where a tab this app cannot show falls back to. */
export const DEFAULT_MOBILE_SETTINGS_TAB: SettingsTabKey = "llms"

/**
 * The open tab, from `?tab=`. Anything this app cannot render — or that this deployment gates
 * off — falls back to AI providers.
 *
 * The value is read from `asPath`, not `router.query`: the Pages Router leaves `query` empty
 * until it is ready, so a deep link to a tab rendered the fallback for a frame first.
 */
export const useActiveSettingsTab = (): SettingsTabKey => {
    const router = useRouter()
    const access = useMobileSettingsAccess()

    const fromQuery = typeof router.query.tab === "string" ? router.query.tab : null
    const fromPath = router.asPath.split("?")[1]
        ? new URLSearchParams(router.asPath.split("?")[1]).get("tab")
        : null
    const requested = fromQuery ?? fromPath

    if (!AVAILABLE_SETTINGS_TABS.includes(requested as SettingsTabKey))
        return DEFAULT_MOBILE_SETTINGS_TAB
    if (requested === "tools" && !access.canShowTools) return DEFAULT_MOBILE_SETTINGS_TAB
    if (requested === "billing" && !access.billingEnabled) return DEFAULT_MOBILE_SETTINGS_TAB
    // The wallet routes are EE-only, whatever the mirrored wallet flag says.
    if (
        requested === "walletUsage" &&
        !(access.isEE && access.walletsEnabled && access.walletDebug)
    )
        return DEFAULT_MOBILE_SETTINGS_TAB
    if (requested === "credits" && !(access.isEE && access.walletsEnabled))
        return DEFAULT_MOBILE_SETTINGS_TAB
    // A deployment serving no MCP gateway refuses every route behind this tab, so a deep
    // link to it would render a surface whose every action fails.
    if (requested === "mcpEndpoints" && !access.canShowMcpEndpoints)
        return DEFAULT_MOBILE_SETTINGS_TAB
    return requested as SettingsTabKey
}
