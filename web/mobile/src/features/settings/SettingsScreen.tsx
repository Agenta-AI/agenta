import {
    CLOSED_SETTINGS_ACCESS,
    getSettingsTabDescription,
    getSettingsTabLabel,
} from "@agenta/settings"
import {PreferencesPage, SettingsPageShell} from "@agenta/settings-ui"
import {useThemeMode} from "@agenta/ui/theme"

import {ContentRail} from "@/components/ContentRail"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useCurrentProject} from "../context/useCurrentProject"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

const THEME_OPTIONS = [
    {mode: "light", label: "Light"},
    {mode: "dark", label: "Dark"},
    {mode: "system", label: "System default"},
]

/**
 * Settings on /m — the SHARED page shell and tab copy, so the title and description read
 * identically to the desktop's.
 *
 * Only Preferences today: it is the one tab that is purely a per-viewer choice, needing no
 * profile, org or permission state. The rest arrive as their data layers are extracted;
 * access stays CLOSED until this app can compute the real flags, so nothing edition-gated
 * can leak in.
 */
export const SettingsScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const project = useCurrentProject(workspaceId, projectId)
    const {themeMode, setMode} = useThemeMode()

    return (
        <>
            <PageTitle parts={["Settings", project?.project_name]} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="border-border shrink-0 border-b px-2 pb-3 pt-2 lg:px-16">
                            <ContentRail className="flex items-center gap-2 lg:max-w-none">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 text-sm font-semibold">Settings</h1>
                            </ContentRail>
                        </div>
                    }
                >
                    <ContentRail className="lg:max-w-none">
                        <SettingsPageShell
                            variant="form"
                            title={getSettingsTabLabel("preferences", CLOSED_SETTINGS_ACCESS)}
                            description={getSettingsTabDescription(
                                "preferences",
                                CLOSED_SETTINGS_ACCESS,
                            )}
                        >
                            <PreferencesPage
                                theme={{
                                    options: THEME_OPTIONS,
                                    mode: themeMode,
                                    onSelect: (mode) => setMode(mode as typeof themeMode),
                                }}
                            />
                        </SettingsPageShell>
                    </ContentRail>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
