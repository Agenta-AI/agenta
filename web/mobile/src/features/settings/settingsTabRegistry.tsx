import type {ComponentType} from "react"

import type {SettingsTabKey} from "@agenta/settings"
import dynamic from "next/dynamic"

import type {SettingsTabProps} from "./settingsTabProps"
import {SettingsTabSkeleton} from "./states/SettingsTabSkeleton"

import {billingUrl} from "@/lib/context"

type Loader = () => Promise<ComponentType<SettingsTabProps>>

const LOADERS: Partial<Record<SettingsTabKey, Loader>> = {
    llms: () => import("./LlmProvidersTab").then((m) => m.LlmProvidersTab),
    tools: () => import("./IntegrationsTab").then((m) => m.IntegrationsTab),
    secrets: () => import("./SecretsTab").then((m) => m.SecretsTab),
    mcpEndpoints: () => import("./McpServersTab").then((m) => m.McpServersTab),
    channels: () => import("./ChannelsTab").then((m) => m.ChannelsTab),
    apiKeys: () => import("./ApiKeysTab").then((m) => m.ApiKeysTab),
    webhooks: () => import("./WebhooksTab").then((m) => m.WebhooksTab),
    analytics: () => import("./AnalyticsTab").then((m) => m.AnalyticsTab),
    billing: () => import("./BillingTab").then((m) => m.BillingTab),
    credits: () =>
        import("../wallet/CreditsTab").then(({CreditsTab}) => {
            const Credits = ({workspaceId, projectId}: SettingsTabProps) => (
                <CreditsTab
                    projectId={projectId}
                    billingURL={billingUrl({workspaceId, projectId})}
                />
            )
            return Credits
        }),
    walletUsage: () => import("../wallet/WalletUsageTab").then((m) => m.WalletUsageTab),
    workspace: () => import("./MembersTab").then((m) => m.MembersTab),
    organizationGeneral: () => import("./OrganizationsTab").then((m) => m.OrganizationsTab),
    projects: () => import("./ProjectsTab").then((m) => m.ProjectsTab),
    organization: () => import("./AccessSecurityTab").then((m) => m.AccessSecurityTab),
    auditLog: () => import("./AuditLogTab").then((m) => m.AuditLogTab),
    account: () => import("./AccountTab").then((m) => m.AccountTab),
    preferences: () => import("./PreferencesTab").then((m) => m.PreferencesTab),
}

/** Each tab's code loads on first open; `preloadSettingsTab` warms it ahead of a click. */
export const SETTINGS_TAB_COMPONENTS = Object.fromEntries(
    Object.entries(LOADERS).map(([key, load]) => [
        key,
        dynamic(load as Loader, {loading: () => <SettingsTabSkeleton />, ssr: false}),
    ]),
) as Partial<Record<SettingsTabKey, ComponentType<SettingsTabProps>>>

export const preloadSettingsTab = (key: string) => {
    void LOADERS[key as SettingsTabKey]?.()
}

export const preloadAllSettingsTabs = () => {
    Object.values(LOADERS).forEach((load) => void load?.())
}
