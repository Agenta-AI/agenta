import {useMemo} from "react"

import type {SettingsAccess, SettingsTabKey} from "@agenta/settings"
import {isBillingEnabled, isEE, isToolsEnabled} from "@agenta/shared/api"
import {useRouter} from "next/router"

/** Tabs this app has a page for. The rest are listed nowhere rather than dead-ending. */
export const AVAILABLE_SETTINGS_TABS: SettingsTabKey[] = [
    "apiKeys",
    "llms",
    "secrets",
    "webhooks",
    "tools",
    "triggers",
    "organizationGeneral",
    "workspace",
    "organization",
    "projects",
    "auditLog",
    "billing",
    "account",
    "preferences",
]

/**
 * Read-only host: it renders lists but brings none of the create/edit dialogs, so every write
 * affordance stays off. View flags are optimistic — the API authorizes regardless, and each page
 * has an empty state — while edition comes from the same env the desktop reads.
 */
export const useMobileSettingsAccess = (): SettingsAccess => {
    // Edition and feature gates come from the shared helpers the desktop uses, so a tab cannot
    // be visible here and hidden there. `isEE()` also accepts the `cloud*` tiers, which a bare
    // `=== "ee"` misses.
    const enterprise = isEE()
    const billingEnabled = isBillingEnabled()
    // One env var gates BOTH tabs, matching the desktop's useSettingsAccess.
    const toolsEnabled = isToolsEnabled()

    return useMemo(
        () => ({
            // Names the tab "Usage & Billing" rather than "Usage" — this surface can now change
            // a subscription, not only report against one.
            billingEnabled,
            canShowTools: toolsEnabled,
            canShowTriggers: toolsEnabled,
            canViewApiKeys: true,
            canViewEvents: true,
            isEE: enterprise,
            // Owner-gated tabs (Access & Security, Usage) list themselves optimistically like
            // every other view flag here — their pages are read-only and the API authorizes.
            isOwner: true,
        }),
        [enterprise, billingEnabled, toolsEnabled],
    )
}

/**
 * The open tab, from `?tab=`. Anything this app cannot render falls back to Preferences.
 *
 * `null` until the router is ready: `router.query` is empty on the first client render of a
 * statically optimized page, and answering "preferences" there would open the wrong tab on a
 * direct load of `?tab=billing` and start its queries before correcting itself.
 */
export const useActiveSettingsTab = (): SettingsTabKey | null => {
    const router = useRouter()
    if (!router.isReady) return null

    const requested = typeof router.query.tab === "string" ? router.query.tab : null

    return AVAILABLE_SETTINGS_TABS.includes(requested as SettingsTabKey)
        ? (requested as SettingsTabKey)
        : "preferences"
}
