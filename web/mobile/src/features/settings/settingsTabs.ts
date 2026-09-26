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

/** Tabs this app has a page for. The rest are listed nowhere rather than dead-ending. */
export const AVAILABLE_SETTINGS_TABS: SettingsTabKey[] = [
    "apiKeys",
    "llms",
    "secrets",
    "webhooks",
    "tools",
    "mcpEndpoints",
    "organizationGeneral",
    "workspace",
    "organization",
    "projects",
    "auditLog",
    "billing",
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
        }),
        [enterprise, billingEnabled, toolsEnabled, mcpGatewayEnabled, walletsEnabled],
    )
}

/**
 * The open tab, from `?tab=`. Anything this app cannot render — or that this deployment gates
 * off — falls back to Preferences.
 *
 * The value is read from `asPath`, not `router.query`: the Pages Router leaves `query` empty
 * until it is ready, so a deep link to a tab rendered Preferences for a frame first.
 */
export const useActiveSettingsTab = (): SettingsTabKey => {
    const router = useRouter()
    const access = useMobileSettingsAccess()

    const fromQuery = typeof router.query.tab === "string" ? router.query.tab : null
    const fromPath = router.asPath.split("?")[1]
        ? new URLSearchParams(router.asPath.split("?")[1]).get("tab")
        : null
    const requested = fromQuery ?? fromPath

    if (!AVAILABLE_SETTINGS_TABS.includes(requested as SettingsTabKey)) return "preferences"
    if (requested === "tools" && !access.canShowTools) return "preferences"
    if (requested === "billing" && !access.billingEnabled) return "preferences"
    if (requested === "walletUsage" && !access.walletsEnabled) return "preferences"
    // A deployment serving no MCP gateway refuses every route behind this tab, so a deep
    // link to it would render a surface whose every action fails.
    if (requested === "mcpEndpoints" && !access.canShowMcpEndpoints) return "preferences"
    return requested as SettingsTabKey
}
