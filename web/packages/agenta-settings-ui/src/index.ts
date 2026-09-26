export type {ConfirmDestructive} from "./confirm"
export {default as SettingsPageShell, type SettingsPageShellProps} from "./SettingsPageShell"
export {ThemePicker, type ThemePickerProps, type ThemeChoice} from "./ThemePicker"
export {
    PreferencesPage,
    PREFERENCE_SECTIONS,
    usePreferenceBindings,
    type PreferencesPageProps,
    type PreferenceBinding,
    type PreferenceBindings,
    type PreferenceItem,
    type PreferenceKey,
    type PreferenceSection,
} from "./PreferencesPage"
export {AccountPage, type AccountPageProps} from "./AccountPage"
export {ApiKeysPage, type ApiKeysPageProps} from "./ApiKeysPage"
export {NamedSecretTable, type NamedSecretTableProps} from "./secrets/NamedSecretTable"
export {
    AIProvidersPage,
    SUBSCRIPTION_DOCS_URL,
    type AIProvidersPageProps,
    type ProviderRemovalState,
} from "./providers/AIProvidersPage"
export {WebhooksPage, type WebhooksPageProps} from "./webhooks/WebhooksPage"
export {
    ProjectsPage,
    type ProjectsPageProps,
    type ProjectDialogState,
} from "./projects/ProjectsPage"
export {MembersPage, type MembersPageProps} from "./members/MembersPage"
export {AuditLogPage, type AuditLogPageProps} from "./audit/AuditLogPage"
export {BillingPage, type BillingPageProps} from "./billing/BillingPage"
export {PricingPlans, type PricingPlansProps} from "./billing/PricingPlans"
export {
    CancelSubscriptionReasons,
    CANCEL_REASONS,
    CANCEL_REASON_OTHER,
    type CancelSubscriptionReasonsProps,
} from "./billing/CancelSubscriptionReasons"
export {default as UsageProgressBar, type UsageProgressBarProps} from "./billing/UsageProgressBar"
export {
    fetchBillingUsage,
    fetchBillingPlans,
    fetchBillingPricing,
    switchBillingPlan,
    cancelBillingSubscription,
    checkoutBillingSubscription,
    openBillingPortal,
} from "./billing/api"
export {
    useBillingCatalog,
    type BillingCatalog,
    type UseBillingCatalogParams,
} from "./billing/useBillingCatalog"
export type {
    BillingSubscription,
    BillingUsage,
    BillingUsageMetric,
    BillingUsagePeriod,
    BillingUsageScope,
    BillingPlanOption,
    BillingPlanPrice,
} from "./billing/types"
export {OrganizationsPage, type OrganizationsPageProps} from "./organizations/OrganizationsPage"
export {
    AccessControlsSection,
    type AccessControlsSectionProps,
    type AuthFlagKey,
} from "./access/AccessControlsSection"
export {SettingToggleRow, type SettingToggleRowProps} from "./access/SettingToggleRow"
export {UpgradeNotice, type UpgradeNoticeProps} from "./access/UpgradeNotice"
export {
    AccessUpgradeNotice,
    type AccessUpgradeNoticeProps,
    type AccessFeature,
} from "./access/AccessUpgradeNotice"
export {
    useEntitlements,
    useBillingSubscription,
    fetchAccessPlans,
    fetchCurrentSubscription,
    type Entitlements,
    type PlanFlags,
    type PlansCatalog,
} from "./access/entitlements"
export {DomainsSection, type DomainsSectionProps} from "./access/DomainsSection"
export {SsoProvidersSection, type SsoProvidersSectionProps} from "./access/SsoProvidersSection"
export {
    default as McpServersSection,
    type McpServersSectionCopy,
    type McpServersSectionProps,
} from "./mcp/McpServersSection"
export {
    default as GatewayToolsSection,
    type GatewayToolsSectionCopy,
    type GatewayToolsSectionProps,
} from "./tools/GatewayToolsSection"
// Re-exported, not owned: the hook moved down to the entity layer so the client-tool connect flow
// in @agenta/entity-ui can run it without depending on this package (that direction is a cycle —
// see `web/packages/agenta-shared/tests/unit/workspaceGraph.test.ts`). Kept here so this package's
// public API is unchanged for existing importers.
export {useToolsConnections, type CreateConnectionInput} from "@agenta/entities/gatewayTool"

// Channels connect screen (agent page). The shared UI plus the actions builder the
// hosts (web/oss, /m) wire to the generated channels client.
export {
    ChannelsPage,
    useChannelPanel,
    ChannelsHubView,
    ChannelsSettingsPage,
    CHANNEL_PLATFORMS,
    agentConnectionsOf,
    connectionRowText,
    platformLogo,
    isLiveForAgent,
    ChannelConnectFlow,
    ChannelManagePanel,
    EMPTY_CONNECTIONS,
    NOOP_ACTIONS,
    buildAgentChannelsActions,
    channelKey,
    clientErrorMessage,
    connectionScope,
    mapConnectionRow,
    slackInviteHandle,
    summarizeConnection,
    QrCode,
    encodeQr,
    type AgentChannelsActionsOptions,
    type ChannelsClientLike,
    type ChannelsPageProps,
    type ChannelsPanelRenderProps,
    type UseChannelPanelOptions,
    type ChannelsRoute,
    type ChannelsHubViewProps,
    type ChannelsSettingsPageProps,
    type ChannelConnectFlowProps,
    type ChannelManagePanelProps,
    type ChannelRowSummary,
} from "./channels"
export type {
    ChannelConnection,
    ChannelConnections,
    ChannelPlatform,
    ChannelInstallMode,
    ChannelStatus,
    ChannelAnsweringAgent,
    ChannelScope,
    ChannelSetupField,
    ChannelSetupInfo,
    ChannelsActions,
    ChannelsPanelAgent,
    HostedTelegramLink,
} from "./channels"

// The agent header's Publish button and the panel it opens: Slack, Telegram and API.
export {
    PublishButton,
    AgentPublish,
    AgentApiPanel,
    AGENT_INVOKE_DOCS_URL,
    agentHostFromApiUrl,
    buildAgentSnippets,
    type AgentApiPanelProps,
    type AgentPublishProps,
    type AgentSnippetLang,
    type PublishButtonProps,
} from "./publish"
