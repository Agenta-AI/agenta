import {useMemo, useState} from "react"

import {fetchAllOrgsList, fetchSingleOrg} from "@agenta/entities/organization"
import {useProfile} from "@agenta/entities/profile"
import {fetchAllProjects} from "@agenta/entities/project"
import {
    getSettingsSidebarTabs,
    getSettingsTabDescription,
    getSettingsTabLabel,
    SETTINGS_SCOPES,
    type SettingsTabKey,
} from "@agenta/settings"
import {useApiKeys, type SettingsAccess} from "@agenta/settings"
import {
    AccountPage,
    ApiKeysPage,
    MembersPage,
    NamedSecretTable,
    OrganizationsPage,
    PreferencesPage,
    ProjectsPage,
    SecretProviderTable,
    SettingsPageShell,
    WebhooksPage,
} from "@agenta/settings-ui"
import {getEnv} from "@agenta/shared/api"
import {useThemeMode} from "@agenta/ui/theme"
import {useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {ContentRail} from "@/components/ContentRail"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {fetchProjects} from "@/lib/context"
import {cn} from "@/lib/utils"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useCurrentProject} from "../context/useCurrentProject"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

const THEME_OPTIONS = [
    {mode: "light", label: "Light"},
    {mode: "dark", label: "Dark"},
    {mode: "system", label: "System default"},
]

/** Tabs this app has a page for. The rest are listed nowhere rather than dead-ending. */
const AVAILABLE: SettingsTabKey[] = [
    "apiKeys",
    "llms",
    "secrets",
    "webhooks",
    "organizationGeneral",
    "workspace",
    "projects",
    "account",
    "preferences",
]

/**
 * One tab's body. Every page comes from @agenta/settings-ui; this host passes no create/edit
 * dialogs, so each renders read-only — the lists and their empty states, none of the write
 * affordances, which the desktop supplies through its own modals.
 */
const TabBody = ({
    tab,
    access,
    user,
    theme,
    workspaceId,
}: {
    tab: SettingsTabKey
    access: SettingsAccess
    user: {id?: string | null; username?: string | null; email?: string | null} | null
    theme: {options: {mode: string; label: string}[]; mode: string; onSelect: (m: string) => void}
    workspaceId: string
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
        enabled: tab === "projects" || tab === "workspace" || tab === "organizationGeneral",
    })

    // A project carries its organization, which saves resolving one from the workspace id.
    const organizationId = projects.data?.find(
        (project) => project.organization_id,
    )?.organization_id
    // The roster lives on the org's default workspace, not behind a members endpoint — same
    // source the desktop reads, so the two surfaces cannot disagree.
    const org = useQuery({
        queryKey: ["selectedOrg", organizationId],
        queryFn: () => fetchSingleOrg({organizationId: organizationId!}),
        enabled: tab === "workspace" && Boolean(organizationId),
    })
    const organizations = useQuery({
        queryKey: ["orgs"],
        queryFn: () => fetchAllOrgsList(),
        enabled: tab === "organizationGeneral",
    })
    const [memberSearch, setMemberSearch] = useState("")
    const [orgSearch, setOrgSearch] = useState("")

    switch (tab) {
        case "preferences":
            return <PreferencesPage theme={theme} />
        case "account":
            return <AccountPage username={user?.username} email={user?.email} />
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
        case "webhooks":
            return <WebhooksPage />
        case "projects":
            return (
                <ProjectsPage
                    projects={projects.data ?? []}
                    isLoading={projects.isPending}
                    workspaceId={workspaceId}
                />
            )
        case "workspace":
            return (
                <MembersPage
                    members={org.data?.default_workspace?.members ?? []}
                    loading={projects.isPending || org.isPending}
                    searchTerm={memberSearch}
                    onSearchChange={setMemberSearch}
                    signedInUser={user}
                    ownerId={org.data?.owner_id}
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
        default:
            return null
    }
}

/**
 * Settings on /m: the desktop's own tab model as a rail, with one tab open at a time.
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

    // Read-only host: it renders lists but brings none of the create/edit dialogs, so every
    // write affordance stays off. View flags are optimistic — the API authorizes regardless, and
    // each page has an empty state — while edition comes from the same env the desktop reads.
    const isEE = getEnv("NEXT_PUBLIC_AGENTA_LICENSE") === "ee"
    const access: SettingsAccess = useMemo(
        () => ({
            billingEnabled: false,
            canShowTools: false,
            canShowTriggers: false,
            canViewApiKeys: true,
            canViewEvents: false,
            isEE,
            isOwner: false,
        }),
        [isEE],
    )
    const requested = typeof router.query.tab === "string" ? router.query.tab : null
    const active: SettingsTabKey = AVAILABLE.includes(requested as SettingsTabKey)
        ? (requested as SettingsTabKey)
        : "preferences"

    // The desktop's grouping and labels, filtered to what this app implements — so the two
    // rails read the same and cannot drift.
    const groups = useMemo(() => {
        const tabs = getSettingsSidebarTabs(access).filter(
            (tab) => AVAILABLE.includes(tab.key) && !tab.isHidden,
        )
        return SETTINGS_SCOPES.map((scope) => ({
            ...scope,
            tabs: tabs.filter((tab) => tab.scope === scope.key),
        })).filter((scope) => scope.tabs.length > 0)
    }, [access])

    return (
        <>
            <PageTitle parts={["Settings", project?.project_name]} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    fill
                    header={
                        <div className="border-border shrink-0 border-0 border-b border-solid px-2 pb-3 pt-2 lg:px-8">
                            <ContentRail className="flex items-center gap-2 lg:max-w-none">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 text-sm font-semibold">Settings</h1>
                            </ContentRail>
                        </div>
                    }
                >
                    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                        {/* A scrolling strip on a phone, a grouped rail from lg — the desktop's
                            own scopes, so both surfaces list settings the same way. */}
                        <nav className="border-border flex shrink-0 gap-1 overflow-x-auto border-0 border-b border-solid px-2 py-2 lg:w-[220px] lg:flex-col lg:gap-4 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-4">
                            {groups.map((group) => (
                                <div key={group.key} className="flex gap-1 lg:flex-col">
                                    <span className="text-muted-foreground hidden px-2 pb-1 text-[11px] font-medium uppercase tracking-wide lg:block">
                                        {group.title}
                                    </span>
                                    {group.tabs.map((tab) => (
                                        <button
                                            key={tab.key}
                                            type="button"
                                            onClick={() =>
                                                void router.replace(
                                                    {query: {...router.query, tab: tab.key}},
                                                    undefined,
                                                    {shallow: true},
                                                )
                                            }
                                            className={cn(
                                                "shrink-0 cursor-pointer rounded-md border-0 px-3 py-1.5 text-left text-xs",
                                                tab.key === active
                                                    ? "bg-accent text-accent-foreground font-medium"
                                                    : "text-muted-foreground hover:bg-accent/50 bg-transparent",
                                            )}
                                        >
                                            {tab.title}
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </nav>

                        <div className="min-w-0 flex-1 overflow-y-auto">
                            <SettingsPageShell
                                variant="form"
                                title={getSettingsTabLabel(active, access)}
                                description={getSettingsTabDescription(active, access)}
                            >
                                <TabBody
                                    tab={active}
                                    access={access}
                                    user={user}
                                    workspaceId={workspaceId}
                                    theme={{
                                        options: THEME_OPTIONS,
                                        mode: themeMode,
                                        onSelect: (mode) => setMode(mode as typeof themeMode),
                                    }}
                                />
                            </SettingsPageShell>
                        </div>
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
