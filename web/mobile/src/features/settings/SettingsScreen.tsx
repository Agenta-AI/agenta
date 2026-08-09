import {useMemo} from "react"

import {useProfile} from "@agenta/entities/profile"
import {
    CLOSED_SETTINGS_ACCESS,
    getSettingsSidebarTabs,
    getSettingsTabDescription,
    getSettingsTabLabel,
    SETTINGS_SCOPES,
    type SettingsTabKey,
} from "@agenta/settings"
import {AccountPage, PreferencesPage, SettingsPageShell} from "@agenta/settings-ui"
import {useThemeMode} from "@agenta/ui/theme"
import {useRouter} from "next/router"

import {ContentRail} from "@/components/ContentRail"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
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

/** Tabs this app can actually render; the rest are listed nowhere rather than dead-ending. */
const AVAILABLE: SettingsTabKey[] = ["preferences", "account"]

/**
 * Settings on /m: the desktop's own tab model as a rail, with one tab open at a time.
 *
 * Access stays CLOSED until this app can compute real edition and permission flags, so nothing
 * gated can appear; the rail is further narrowed to the tabs that exist here.
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

    const access = CLOSED_SETTINGS_ACCESS
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
                                {active === "preferences" ? (
                                    <PreferencesPage
                                        theme={{
                                            options: THEME_OPTIONS,
                                            mode: themeMode,
                                            onSelect: (mode) => setMode(mode as typeof themeMode),
                                        }}
                                    />
                                ) : (
                                    // Identity only: deleting an account is an EE capability and
                                    // this app has no EE surface.
                                    <AccountPage username={user?.username} email={user?.email} />
                                )}
                            </SettingsPageShell>
                        </div>
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
