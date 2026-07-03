export const DEFAULT_SETTINGS_TAB = "workspace"

export type SettingsTabKey =
    | "apiKeys"
    | "secrets"
    | "llms"
    | "tools"
    | "triggers"
    | "webhooks"
    | "workspace"
    | "projects"
    | "organization"
    | "auditLog"
    | "billing"
    | "account"

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
    showInSidebar?: boolean
    getLabel?: (access: SettingsAccess) => string
}

export const SETTINGS_TABS: SettingsTabDefinition[] = [
    {key: "apiKeys"},
    {key: "secrets"},
    {key: "llms"},
    {key: "tools"},
    {key: "triggers"},
    {key: "webhooks"},
    {key: "workspace"},
    {key: "projects", showInSidebar: false},
    {key: "organization"},
    {key: "auditLog"},
    {
        key: "billing",
        getLabel: ({billingEnabled}) => (billingEnabled ? "Usage & Billing" : "Usage"),
    },
    {key: "account"},
]

const SETTINGS_LABELS: Record<Exclude<SettingsTabKey, "billing">, string> = {
    apiKeys: "API Keys",
    secrets: "Secrets",
    llms: "LLMs",
    tools: "Tools",
    triggers: "Triggers",
    webhooks: "Webhooks",
    workspace: "Members",
    projects: "Projects",
    organization: "Access & Security",
    auditLog: "Audit Log",
    account: "Account",
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
