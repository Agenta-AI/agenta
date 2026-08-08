export const DEFAULT_SETTINGS_TAB = "workspace"

export type SettingsTabKey =
    | "apiKeys"
    | "secrets"
    | "llms"
    | "tools"
    | "triggers"
    | "channels"
    | "webhooks"
    | "workspace"
    | "projects"
    | "organizationGeneral"
    | "organization"
    | "auditLog"
    | "billing"
    | "account"
    | "featureFlags"

export type SettingsScopeKey = "project" | "organization" | "personal"

export interface SettingsAccess {
    billingEnabled: boolean
    canShowTools: boolean
    canShowTriggers: boolean
    canViewApiKeys: boolean
    canViewEvents: boolean
    isEE: boolean
    isOwner: boolean
}

export interface SettingsTabDefinition {
    key: SettingsTabKey
    scope: SettingsScopeKey
    showInSidebar?: boolean
    getLabel?: (access: SettingsAccess) => string
}

export const SETTINGS_TABS: SettingsTabDefinition[] = [
    {key: "apiKeys", scope: "project"},
    {key: "secrets", scope: "project"},
    {key: "llms", scope: "project"},
    {key: "tools", scope: "project"},
    {key: "triggers", scope: "project"},
    {key: "channels", scope: "project"},
    {key: "webhooks", scope: "project"},
    {key: "organizationGeneral", scope: "organization"},
    {key: "workspace", scope: "organization"},
    {key: "projects", scope: "organization"},
    {key: "organization", scope: "organization"},
    {key: "auditLog", scope: "organization"},
    {
        key: "billing",
        scope: "organization",
        getLabel: ({billingEnabled}) => (billingEnabled ? "Usage & Billing" : "Usage"),
    },
    {key: "account", scope: "personal"},
    {key: "featureFlags", scope: "personal"},
]

export const SETTINGS_SCOPES: {key: SettingsScopeKey; title: string}[] = [
    {key: "project", title: "Project"},
    {key: "organization", title: "Organization"},
    {key: "personal", title: "Personal"},
]

const SETTINGS_LABELS: Record<Exclude<SettingsTabKey, "billing">, string> = {
    apiKeys: "API Keys",
    secrets: "Secrets",
    llms: "LLMs",
    tools: "Tools",
    triggers: "Triggers",
    channels: "Channels",
    webhooks: "Webhooks",
    workspace: "Members",
    projects: "Projects",
    organizationGeneral: "General",
    organization: "Access & Security",
    auditLog: "Audit Log",
    account: "Account",
    featureFlags: "Feature flags",
}

export const isSettingsTabKey = (value: string | null | undefined): value is SettingsTabKey =>
    !!value && SETTINGS_TABS.some((tab) => tab.key === value)

export const getSettingsTabLabel = (key: SettingsTabKey, access: SettingsAccess) => {
    const tab = SETTINGS_TABS.find((item) => item.key === key)
    if (tab?.getLabel) return tab.getLabel(access)
    return SETTINGS_LABELS[key as Exclude<SettingsTabKey, "billing">]
}

export const isSettingsTabVisible = (key: SettingsTabKey, access: SettingsAccess) => {
    switch (key) {
        case "apiKeys":
            return access.canViewApiKeys
        case "tools":
            return access.canShowTools
        case "triggers":
            return access.canShowTriggers
        case "organizationGeneral":
            return access.isOwner
        case "organization":
            return access.isEE && access.isOwner
        case "auditLog":
            return access.isEE && access.canViewEvents
        case "billing":
            return access.isEE && access.isOwner
        case "account":
            return access.isEE
        default:
            return true
    }
}

export const resolveSettingsTab = (
    requestedTab: string | null | undefined,
    access: SettingsAccess,
): SettingsTabKey => {
    if (!isSettingsTabKey(requestedTab)) return DEFAULT_SETTINGS_TAB
    return isSettingsTabVisible(requestedTab, access) ? requestedTab : DEFAULT_SETTINGS_TAB
}

export const getSettingsSidebarTabs = (access: SettingsAccess) =>
    SETTINGS_TABS.filter((tab) => tab.showInSidebar !== false).map((tab) => ({
        ...tab,
        title: getSettingsTabLabel(tab.key, access),
        isHidden: !isSettingsTabVisible(tab.key, access),
    }))
