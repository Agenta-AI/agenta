import {useMemo} from "react"

import {useProfile} from "@agenta/entities/profile"
import type {SettingsAccess, SettingsTabKey} from "@agenta/settings"
import {
    isBillingEnabled,
    isEE,
    isMcpGatewayEnabled,
    isToolsEnabled,
    isWalletsEnabled,
} from "@agenta/shared/api"
import {useRouter} from "next/router"

import {useProjectPermissionState} from "../context/useProjectPermission"
import {useWalletSummary} from "../wallet/useWalletSummary"

import {useSettingsOrg} from "./useSettingsOrg"

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
    "credits",
    "billing",
    "workspace",
    "organizationGeneral",
    "projects",
    "organization",
    "auditLog",
    "account",
    "preferences",
]

/**
 * Read-only host for most tabs: it renders lists but brings none of the create/edit dialogs,
 * so those write affordances stay off. Tools and MCP servers are the exceptions — their
 * sections moved to `@agenta/settings-ui` and carry their own dialogs, so this app renders
 * the same surface the desktop does. Edition comes from the same env the desktop reads. Flags that
 * name a role's reach (Analytics, Access & Security) come from the backend check, so a reader never
 * opens a page whose every request the API would refuse; the rest are optimistic view flags.
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
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const walletEnforced = useWalletSummary(projectId).data?.mode === "enforce"
    // Analytics reads trace content, which a role without `view_spans` cannot read at all.
    const analytics = useProjectPermissionState(projectId, "view_spans")
    // Access & Security writes organization flags, which the API allows the owner only.
    const {user} = useProfile()
    const {org} = useSettingsOrg(workspaceId)
    const ownerId = org.data?.owner_id
    const isOwner = Boolean(ownerId && user?.id && ownerId === user.id)

    return useMemo(
        () => ({
            // Names the tab "Plan & billing" rather than "Usage" — this surface can change a
            // subscription, not only report against one.
            billingEnabled,
            canShowMcpEndpoints: mcpGatewayEnabled,
            canShowTools: toolsEnabled,
            canViewApiKeys: true,
            canViewEvents: true,
            isEE: enterprise,
            canViewAnalytics: analytics.allowed,
            // Every role reads the plan and its limits; the controls on that page gate themselves.
            canViewBilling: true,
            // Access & Security changes organization flags, which only the owner may do.
            isOwner,
            walletsEnabled,
            walletEnforced,
        }),
        [
            analytics.allowed,
            enterprise,
            billingEnabled,
            isOwner,
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
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : ""
    const workspaceId =
        typeof router.query.workspace_id === "string" ? router.query.workspace_id : ""
    const analytics = useProjectPermissionState(projectId, "view_spans")
    const {loading: ownerPending} = useSettingsOrg(workspaceId)

    const fromQuery = typeof router.query.tab === "string" ? router.query.tab : null
    const fromPath = router.asPath.split("?")[1]
        ? new URLSearchParams(router.asPath.split("?")[1]).get("tab")
        : null
    const asked = fromQuery ?? fromPath
    // The wallet's debug tab folded into Credits; old links land there.
    const requested = asked === "walletUsage" ? "credits" : asked

    if (!AVAILABLE_SETTINGS_TABS.includes(requested as SettingsTabKey))
        return DEFAULT_MOBILE_SETTINGS_TAB
    if (requested === "tools" && !access.canShowTools) return DEFAULT_MOBILE_SETTINGS_TAB
    if (requested === "billing" && !access.isEE) return DEFAULT_MOBILE_SETTINGS_TAB
    // Analytics reads trace content: a role without it would see an empty page of refusals. The
    // tab holds while the check is in flight, so a reader who may open it is never bounced.
    if (requested === "analytics" && !access.canViewAnalytics && !analytics.pending)
        return DEFAULT_MOBILE_SETTINGS_TAB
    // Access & Security belongs to the organization owner; it holds while ownership is unknown.
    if (requested === "organization" && !access.isOwner && !ownerPending)
        return DEFAULT_MOBILE_SETTINGS_TAB
    // The wallet routes are EE-only, whatever the mirrored wallet flag says.
    if (requested === "credits" && !(access.isEE && access.walletsEnabled))
        return DEFAULT_MOBILE_SETTINGS_TAB
    // A deployment serving no MCP gateway refuses every route behind this tab, so a deep
    // link to it would render a surface whose every action fails.
    if (requested === "mcpEndpoints" && !access.canShowMcpEndpoints)
        return DEFAULT_MOBILE_SETTINGS_TAB
    return requested as SettingsTabKey
}
