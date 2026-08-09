import {useCallback, useState} from "react"

import {
    fetchAllOrgsList,
    fetchOrganizationDomains,
    fetchOrganizationProviders,
    fetchSingleOrg,
    updateOrganization,
    type OrganizationFlags,
    type OrganizationProvider,
} from "@agenta/entities/organization"
import {useProfile} from "@agenta/entities/profile"
import {fetchAllProjects} from "@agenta/entities/project"
import {getSettingsTabDescription, getSettingsTabLabel, type SettingsTabKey} from "@agenta/settings"
import {useApiKeys, type SettingsAccess} from "@agenta/settings"
import {
    AccessControlsSection,
    type AccessFeature,
    AccessUpgradeNotice,
    ApiKeysPage,
    AuditLogPage,
    type AuthFlagKey,
    DomainsSection,
    GatewayToolsSection,
    NamedSecretTable,
    OrganizationsPage,
    SsoProvidersSection,
    TriggerConnectionsSection,
    TriggerSchedulesSection,
    TriggerSubscriptionsSection,
    SecretProviderTable,
    SettingsPageShell,
    useEntitlements,
    WebhooksPage,
} from "@agenta/settings-ui"
import {useThemeMode} from "@agenta/ui/theme"
import {useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {ContentRail} from "@/components/ContentRail"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useCurrentProject} from "../context/useCurrentProject"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {AccountTab} from "./AccountTab"
import {BillingTab} from "./BillingTab"
import {MembersTab} from "./MembersTab"
import {isNestedSettingsNavEnabled} from "./nestedNav"
import {PreferencesTab} from "./PreferencesTab"
import {ProjectsTab} from "./ProjectsTab"
import {useSettingsNavScope} from "./settingsNavScope"
import {SettingsTabRail} from "./SettingsTabRail"
import {useActiveSettingsTab, useMobileSettingsAccess} from "./settingsTabs"

const THEME_OPTIONS = [
    {mode: "light", label: "Light"},
    {mode: "dark", label: "Dark"},
    {mode: "system", label: "System default"},
]

/**
 * One tab's body. Every page comes from @agenta/settings-ui. Tabs with a *Tab wrapper bring
 * this app's own bottom sheets for their writes; the rest render read-only — the lists and
 * their empty states, none of the write affordances.
 */
const TabBody = ({
    tab,
    access,
    user,
    theme,
    workspaceId,
    projectId,
}: {
    tab: SettingsTabKey
    access: SettingsAccess
    user: {id?: string | null; username?: string | null; email?: string | null} | null
    theme: {options: {mode: string; label: string}[]; mode: string; onSelect: (m: string) => void}
    workspaceId: string
    projectId: string
}) => {
    const keys = useApiKeys({
        workspaceId,
        canView: tab === "apiKeys" && access.canViewApiKeys,
        canEdit: false,
        confirmDelete: async () => false,
        onCreated: () => undefined,
    })

    const projects = useQuery({
        queryKey: ["projects", workspaceId],
        queryFn: () => fetchAllProjects(workspaceId),
        // Every organization-scoped tab resolves its org id from this list.
        enabled: tab !== "preferences" && tab !== "account",
    })

    // A project carries its organization, which saves resolving one from the workspace id.
    const organizationId = projects.data?.find(
        (project) => project.organization_id && project.workspace_id === workspaceId,
    )?.organization_id
    // The roster lives on the org's default workspace, not behind a members endpoint — same
    // source the desktop reads, so the two surfaces cannot disagree.
    const org = useQuery({
        queryKey: ["selectedOrg", organizationId],
        queryFn: () => fetchSingleOrg({organizationId: organizationId!}),
        enabled: (tab === "workspace" || tab === "organization") && Boolean(organizationId),
    })
    const organizations = useQuery({
        queryKey: ["orgs"],
        queryFn: () => fetchAllOrgsList(),
        enabled: tab === "organizationGeneral",
    })
    const domains = useQuery({
        queryKey: ["organization-domains", organizationId],
        queryFn: () => fetchOrganizationDomains(),
        enabled: tab === "organization" && Boolean(organizationId),
    })
    const providers = useQuery({
        queryKey: ["organization-providers", organizationId],
        queryFn: () => fetchOrganizationProviders(),
        enabled: tab === "organization" && Boolean(organizationId),
    })
    // The same two responses the desktop gates on, so a plan without a feature reads the same
    // on both surfaces instead of /m quietly showing controls the plan does not include.
    const entitlements = useEntitlements({
        projectId,
        enabled: access.isEE && (tab === "organization" || tab === "auditLog"),
    })
    const [memberSearch, setMemberSearch] = useState("")
    const [orgSearch, setOrgSearch] = useState("")

    const [savingFlag, setSavingFlag] = useState<AuthFlagKey | null>(null)
    const [lastSavedFlag, setLastSavedFlag] = useState<AuthFlagKey | null>(null)
    const [flagError, setFlagError] = useState<string | null>(null)
    const setFlag = async (flag: AuthFlagKey, value: boolean) => {
        if (!organizationId) return
        setSavingFlag(flag)
        setFlagError(null)
        setLastSavedFlag(null)
        try {
            await updateOrganization(organizationId, {flags: {[flag]: value}})
            await org.refetch()
            setLastSavedFlag(flag)
        } catch (error) {
            // The switches are driven by the server's flags, never by local state, so a failed
            // write needs no revert — the row simply stays where it was. Which reads as a dead
            // toggle unless we say why.
            setFlagError(
                error instanceof Error && error.message
                    ? error.message
                    : "Could not save that setting. Try again.",
            )
        } finally {
            setSavingFlag(null)
        }
    }
    // "Saved" is a transient marker; without this it sits on the row for the rest of the session.
    useEffect(() => {
        if (!lastSavedFlag) return
        const timer = window.setTimeout(() => setLastSavedFlag(null), 3000)
        return () => window.clearTimeout(timer)
    }, [lastSavedFlag])

    switch (tab) {
        case "preferences":
            return <PreferencesTab theme={theme} />
        case "account":
            return <AccountTab user={user} />
        case "apiKeys":
            return (
                <ApiKeysPage
                    rows={keys.keys}
                    listing={keys.listing}
                    creating={false}
                    canView={access.canViewApiKeys}
                    canEdit={false}
                    onReload={keys.list}
                    onCreate={() => undefined}
                    onDelete={() => undefined}
                />
            )
        case "llms":
            return (
                <div className="flex flex-col gap-8">
                    <SecretProviderTable type="standard" />
                    <SecretProviderTable type="custom" />
                </div>
            )
        case "secrets":
            return <NamedSecretTable />
        // No date-range picker — the desktop's preset picker is its own. The entitlement gate
        // is the desktop's, so a plan without Audit Log reads the same on both.
        case "auditLog":
            return (
                <AuditLogPage
                    hasAudit={entitlements.hasAudit}
                    entitlementsLoading={entitlements.isLoading}
                />
            )
        case "billing":
            return <BillingTab projectId={projectId} />
        case "webhooks":
            return <WebhooksPage />
        // Read-only: the create/edit drawers still render antd forms, which have no
        // ConfigProvider here and would come out light on a dark page.
        case "tools":
            return <GatewayToolsSection readOnly />
        case "triggers":
            return (
                <div className="flex flex-col gap-8">
                    <TriggerConnectionsSection readOnly />
                    <TriggerSubscriptionsSection readOnly />
                    <TriggerSchedulesSection readOnly />
                </div>
            )
        case "projects":
            return (
                <ProjectsTab
                    projects={projects.data ?? []}
                    isLoading={projects.isPending}
                    workspaceId={workspaceId}
                />
            )
        case "workspace":
            return (
                <MembersTab
                    members={org.data?.default_workspace?.members ?? []}
                    loading={projects.isPending || org.isPending}
                    searchTerm={memberSearch}
                    onSearchChange={setMemberSearch}
                    signedInUser={user}
                    ownerId={org.data?.owner_id}
                    organizationId={organizationId}
                    workspaceId={org.data?.default_workspace?.id}
                    onChanged={() => void org.refetch()}
                />
            )
        case "organizationGeneral":
            return (
                <OrganizationsPage
                    organizations={organizations.data ?? []}
                    loading={organizations.isPending}
                    searchTerm={orgSearch}
                    onSearchChange={setOrgSearch}
                    selectedOrgId={organizationId}
                    currentUserId={user?.id}
                />
            )
        case "organization": {
            // This tab's org id comes from the projects list, so both queries are its loading
            // state — and a disabled query stays `pending` forever, hence the explicit id check.
            if (projects.isPending || (organizationId && org.isPending))
                return <SettingsSectionSkeleton />
            if (projects.isError || org.isError)
                return (
                    <SettingsLoadError
                        text="Could not load this organization's settings."
                        onRetry={() => {
                            void projects.refetch()
                            void org.refetch()
                        }}
                    />
                )
            const flags = org.data?.flags as OrganizationFlags | undefined
            // Waiting on entitlements too: every `has*` reads false until they land, so
            // rendering now would flash the locked state at an entitled organization.
            if (!flags || entitlements.isLoading) return null
            const domainList = domains.data ?? []
            const providerList = providers.data ?? []
            const orgSlug = org.data?.slug
            // Three independently-sold features. Whatever the plan excludes is said once, at the
            // end, rather than as a lock card per section. No upgrade link: changing a plan means
            // Stripe, which lives on the desktop.
            const locked: AccessFeature[] = [
                !entitlements.hasAccessControl && "access",
                !entitlements.hasDomains && "domains",
                !entitlements.hasSSO && "sso",
            ].filter(Boolean) as AccessFeature[]

            return (
                <div className="flex flex-col gap-8">
                    {entitlements.hasAccessControl ? (
                        <AccessControlsSection
                            flags={flags}
                            onFlagChange={(flag, value) => void setFlag(flag, value)}
                            updating={Boolean(savingFlag)}
                            lastSavedFlag={lastSavedFlag}
                            hasActiveVerifiedProvider={providerList.some(
                                (provider) => provider.flags?.is_active && provider.flags?.is_valid,
                            )}
                            hasVerifiedDomain={domainList.some(
                                (domain) => domain.flags?.is_verified,
                            )}
                        />
                    ) : null}

                    {/* Read-only here: adding a domain or provider means DNS records and IdP
                        setup, which belong on the desktop. */}
                    {entitlements.hasDomains ? (
                        <DomainsSection domains={domainList} loading={domains.isPending} />
                    ) : null}

                    {entitlements.hasSSO ? (
                        <SsoProvidersSection
                            providers={providerList}
                            loading={providers.isPending}
                            callbackUrlFor={(provider: OrganizationProvider) =>
                                orgSlug
                                    ? `${window.location.origin}/auth/callback/sso:${orgSlug}:${provider.slug}`
                                    : null
                            }
                        />
                    ) : null}

                    <AccessUpgradeNotice locked={locked} />
                </div>
            )
        }
        default:
            return null
    }
}

/**
 * Settings on /m: the desktop's own tab model, with one tab open at a time.
 *
 * By default the settings nav TAKES OVER the main sidebar exactly as oss/ee do — no second rail,
 * no in-page top bar, the content pane starts at the tab title. `NEXT_PUBLIC_SETTINGS_NESTED_NAV`
 * brings back the nested rail beside the main one.
 *
 * Every page is the shared one. This host is read-only — it brings no create/edit dialogs — so
 * the rail lists what it can show and each page renders without its write affordances.
 */
export const SettingsScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const router = useRouter()
    const project = useCurrentProject(workspaceId, projectId)
    const {themeMode, setMode} = useThemeMode()
    const {user} = useProfile()

    const nestedNav = isNestedSettingsNavEnabled()
    const settingsScope = useSettingsNavScope(workspaceId, projectId)
    const access = useMobileSettingsAccess()
    const active = useActiveSettingsTab()

    const selectTab = useCallback(
        (tab: SettingsTabKey) =>
            void router.replace({query: {...router.query, tab}}, undefined, {shallow: true}),
        [router],
    )

    const content = (
        <div className="min-w-0 flex-1 overflow-y-auto">
            {/* No content cap: the desktop's 640/1120 caps left every section floating in a
                wide empty column here. */}
            <SettingsPageShell
                variant="full"
                title={getSettingsTabLabel(active, access)}
                description={getSettingsTabDescription(active, access)}
            >
                <TabBody
                    tab={active}
                    access={access}
                    user={user}
                    workspaceId={workspaceId}
                    projectId={projectId}
                    theme={{
                        options: THEME_OPTIONS,
                        mode: themeMode,
                        onSelect: (mode) => setMode(mode as typeof themeMode),
                    }}
                />
            </SettingsPageShell>
        </div>
    )

    return (
        <>
            <PageTitle parts={["Settings", project?.project_name]} />
            <AppShell
                workspaceId={workspaceId}
                projectId={projectId}
                scope={nestedNav ? undefined : settingsScope}
            >
                <ScreenScaffold
                    fill
                    header={
                        nestedNav ? (
                            <div className="border-border shrink-0 border-0 border-b border-solid px-2 pb-3 pt-2 lg:px-8">
                                <ContentRail className="flex items-center gap-2 lg:max-w-none">
                                    <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                    <h1 className="m-0 text-sm font-semibold">Settings</h1>
                                </ContentRail>
                            </div>
                        ) : (
                            // Takeover has no top bar. Below lg the rail is a drawer, so the page
                            // still needs the one way into it — the hamburger, nothing else.
                            <div className="border-border shrink-0 border-0 border-b border-solid px-2 py-2 lg:hidden">
                                <NavDrawer
                                    workspaceId={workspaceId}
                                    projectId={projectId}
                                    scope={settingsScope}
                                />
                            </div>
                        )
                    }
                >
                    {nestedNav ? (
                        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                            <SettingsTabRail active={active} onSelect={selectTab} />
                            {content}
                        </div>
                    ) : (
                        content
                    )}
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
