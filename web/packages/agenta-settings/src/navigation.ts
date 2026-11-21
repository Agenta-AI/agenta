import {createT, type CatalogKey} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import type settingsTabsCatalog from "@agenta/i18n/catalogs/settingsTabs"

const t = createT(navigationCatalog)

export const DEFAULT_SETTINGS_TAB = "workspace"

export type SettingsTabKey =
    | "apiKeys"
    | "secrets"
    | "llms"
    | "analytics"
    | "tools"
    | "channels"
    | "webhooks"
    | "mcpEndpoints"
    | "workspace"
    | "projects"
    | "organizationGeneral"
    | "organization"
    | "auditLog"
    | "billing"
    | "credits"
    | "account"
    | "preferences"

export type SettingsScopeKey = "connections" | "project" | "organization" | "personal"

export interface SettingsAccess {
    billingEnabled: boolean
    /** Whether this deployment serves the MCP gateway the endpoints tab manages. */
    canShowMcpEndpoints: boolean
    canShowTools: boolean
    canViewApiKeys: boolean
    canViewEvents: boolean
    isEE: boolean
    isOwner: boolean
    /** Whether the reader may read trace content: without it the Analytics tab has no data and
     * the API refuses every request behind it. Optional because the classic app (/w), which takes
     * no new edits, does not pass it and keeps the tab. */
    canViewAnalytics?: boolean
    /** Whether the reader may read the plan and its limits. /m passes true for every role; the
     * classic app (/w) does not pass it and keeps its owner-only check. */
    canViewBilling?: boolean
    /** Whether the credit wallet is on. Only then does its debug view have data behind it. */
    walletsEnabled?: boolean
    /** Whether credits stop this organization's work (its wallet is enforced). */
    walletEnforced?: boolean
}

/** A tertiary docs link rendered at the far right of a settings page header. */
export interface SettingsTabDocs {
    label: string
    href: string
}

type SettingsTabTextKey = CatalogKey<typeof settingsTabsCatalog>

interface SettingsTabDocsDefinition {
    labelKey: SettingsTabTextKey
    href: string
}

export interface SettingsTabDefinition {
    key: SettingsTabKey
    scope: SettingsScopeKey
    showInSidebar?: boolean
    getLabel?: (access: SettingsAccess) => string
    /**
     * One sentence explaining what the page is for. Required so a new tab cannot ship
     * without one — every settings page renders this under its title.
     */
    descriptionKey: SettingsTabTextKey
    /** Overrides `descriptionKey` when the copy depends on entitlements. */
    getDescriptionKey?: (access: SettingsAccess) => SettingsTabTextKey
    docs?: SettingsTabDocsDefinition
}

const DOCS_BASE = "https://docs.agenta.ai"

/** In sidebar order: each scope lists its tabs in the order they appear here. */
export const SETTINGS_TABS: SettingsTabDefinition[] = [
    {
        key: "llms",
        scope: "connections",
        descriptionKey: "settingsTabs.llmsDescription",
        docs: {
            labelKey: "settingsTabs.llmsDocs",
            href: `${DOCS_BASE}/faq/integrations/llm-providers`,
        },
    },
    {
        key: "tools",
        scope: "connections",
        descriptionKey: "settingsTabs.toolsDescription",
        docs: {
            labelKey: "settingsTabs.toolsDocs",
            href: `${DOCS_BASE}/concepts/tools-and-integrations`,
        },
    },
    {
        key: "secrets",
        scope: "connections",
        descriptionKey: "settingsTabs.secretsDescription",
    },
    {
        key: "mcpEndpoints",
        scope: "connections",
        descriptionKey: "settingsTabs.mcpEndpointsDescription",
    },
    {
        key: "channels",
        scope: "connections",
        descriptionKey: "settingsTabs.channelsDescription",
    },
    {
        key: "apiKeys",
        scope: "project",
        descriptionKey: "settingsTabs.apiKeysDescription",
        docs: {
            labelKey: "settingsTabs.apiKeysDocs",
            href: `${DOCS_BASE}/reference/api-guide/overview`,
        },
    },
    {
        key: "webhooks",
        scope: "project",
        descriptionKey: "settingsTabs.webhooksDescription",
    },
    {
        key: "analytics",
        scope: "project",
        descriptionKey: "settingsTabs.analyticsDescription",
    },
    {
        key: "credits",
        scope: "organization",
        descriptionKey: "settingsTabs.creditsDescription",
    },
    {
        key: "billing",
        scope: "organization",
        getLabel: ({billingEnabled}) =>
            t(
                billingEnabled
                    ? "navigation.settings.billingPlan"
                    : "navigation.settings.billingUsage",
            ),
        descriptionKey: "settingsTabs.billingDescription",
        getDescriptionKey: ({billingEnabled}) =>
            billingEnabled
                ? "settingsTabs.billingPlanDescription"
                : "settingsTabs.billingDescription",
    },
    {
        key: "workspace",
        scope: "organization",
        descriptionKey: "settingsTabs.workspaceDescription",
        docs: {
            labelKey: "settingsTabs.workspaceDocs",
            href: `${DOCS_BASE}/administration/access-control/rbac`,
        },
    },
    {
        key: "organizationGeneral",
        scope: "organization",
        descriptionKey: "settingsTabs.organizationGeneralDescription",
        docs: {
            labelKey: "settingsTabs.organizationGeneralDocs",
            href: `${DOCS_BASE}/administration/access-control/organizations`,
        },
    },
    {
        key: "projects",
        scope: "organization",
        descriptionKey: "settingsTabs.projectsDescription",
        docs: {
            labelKey: "settingsTabs.projectsDocs",
            href: `${DOCS_BASE}/administration/access-control/organizations`,
        },
    },
    {
        key: "organization",
        scope: "organization",
        descriptionKey: "settingsTabs.organizationDescription",
        docs: {
            labelKey: "settingsTabs.organizationDocs",
            href: `${DOCS_BASE}/administration/access-control/sso`,
        },
    },
    {
        key: "auditLog",
        scope: "organization",
        descriptionKey: "settingsTabs.auditLogDescription",
    },
    {
        key: "account",
        scope: "personal",
        descriptionKey: "settingsTabs.accountDescription",
    },
    {
        key: "preferences",
        scope: "personal",
        descriptionKey: "settingsTabs.preferencesDescription",
    },
]

export const SETTINGS_SCOPES: {
    key: SettingsScopeKey
    titleKey: CatalogKey<typeof navigationCatalog>
}[] = [
    // What agents connect to, whoever owns it; the `?tab=` links are the same as before.
    {key: "connections", titleKey: "navigation.settings.scopeConnections"},
    {key: "project", titleKey: "navigation.settings.scopeProject"},
    {key: "organization", titleKey: "navigation.settings.scopeOrganization"},
    {key: "personal", titleKey: "navigation.settings.scopePersonal"},
]

const SETTINGS_LABELS: Record<
    Exclude<SettingsTabKey, "billing">,
    CatalogKey<typeof navigationCatalog>
> = {
    apiKeys: "navigation.settings.apiKeys",
    secrets: "navigation.settings.secrets",
    // The tab key stays `llms` so existing `?tab=llms` links keep working.
    llms: "navigation.settings.llms",
    analytics: "navigation.settings.analytics",
    tools: "navigation.settings.tools",
    channels: "navigation.settings.channels",
    webhooks: "navigation.settings.webhooks",
    mcpEndpoints: "navigation.settings.mcpEndpoints",
    workspace: "navigation.settings.workspace",
    projects: "navigation.settings.projects",
    organizationGeneral: "navigation.settings.organizationGeneral",
    organization: "navigation.settings.organization",
    auditLog: "navigation.settings.auditLog",
    credits: "navigation.settings.credits",
    account: "navigation.settings.account",
    preferences: "navigation.settings.preferences",
}

export const isSettingsTabKey = (value: string | null | undefined): value is SettingsTabKey =>
    !!value && SETTINGS_TABS.some((tab) => tab.key === value)

export const getSettingsTabLabel = (key: SettingsTabKey, access: SettingsAccess) => {
    const tab = SETTINGS_TABS.find((item) => item.key === key)
    if (tab?.getLabel) return tab.getLabel(access)
    return t(SETTINGS_LABELS[key as Exclude<SettingsTabKey, "billing">])
}

// `organizationGeneral` is intentionally absent: it lists every organization you belong
// to, so membership is enough. Its destructive row actions gate on ownership per row.
export const isSettingsTabVisible = (key: SettingsTabKey, access: SettingsAccess) => {
    switch (key) {
        case "apiKeys":
            return access.canViewApiKeys
        case "tools":
            return access.canShowTools
        case "mcpEndpoints":
            return access.canShowMcpEndpoints
        case "organization":
            return access.isEE && access.isOwner
        case "auditLog":
            return access.isEE && access.canViewEvents
        case "billing":
            return access.isEE && (access.canViewBilling ?? access.isOwner)
        case "analytics":
            return access.canViewAnalytics ?? true
        case "credits":
            return access.isEE && Boolean(access.walletsEnabled && access.walletEnforced)
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

/** The one tab that wants the whole width: the Audit Log's timestamp + event type + full UUID. */
const FULL_WIDTH_TABS = new Set<SettingsTabKey>(["auditLog"])

/** A Settings tab's `SettingsPageShell` variant: the Audit Log runs full width, the rest centered. */
export const getSettingsTabVariant = (key: SettingsTabKey): "full" | "table" =>
    FULL_WIDTH_TABS.has(key) ? "full" : "table"
