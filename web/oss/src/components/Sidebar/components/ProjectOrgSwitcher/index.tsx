import {memo, useMemo} from "react"

import {
    NamePromptModal,
    ProjectOrgSwitcherView,
    type SwitcherEntry,
    type SwitcherThemeControl,
} from "@agenta/navigation-ui"
import {Desktop, Moon, Sun} from "@phosphor-icons/react"

import {THEME_OPTIONS} from "@/oss/components/Layout/assets/themeOptions"
import {ThemeMode, useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

import {useProjectOrgSwitcher} from "../../hooks/useProjectOrgSwitcher"

const themeIcon = (mode: ThemeMode) => {
    switch (mode) {
        case ThemeMode.Dark:
            return <Moon size={14} className="shrink-0" />
        case ThemeMode.System:
            return <Desktop size={14} className="shrink-0" />
        default:
            return <Sun size={14} className="shrink-0" />
    }
}

interface ProjectOrgSwitcherProps {
    collapsed: boolean
}

/** OSS binding: org state, switching, create mutations and logout wired onto the shared view. */
const ProjectOrgSwitcher = ({collapsed}: ProjectOrgSwitcherProps) => {
    const {
        currentOrg,
        currentProject,
        orgOptions,
        projectsForOrg,
        switchProject,
        switchOrg,
        goToOrgSettings,
        confirmLogout,
        createProject,
        createOrg,
    } = useProjectOrgSwitcher()

    const {themeMode, toggleAppTheme} = useAppTheme()

    const theme = useMemo<SwitcherThemeControl>(
        () => ({
            mode: themeMode,
            onSelect: (mode) => toggleAppTheme(mode as ThemeMode),
            options: THEME_OPTIONS.map(({mode, label, short}) => ({
                mode,
                label,
                short,
                icon: themeIcon(mode),
            })),
        }),
        [themeMode, toggleAppTheme],
    )

    const projects = useMemo<SwitcherEntry[]>(
        () =>
            projectsForOrg.map((proj) => ({
                key: `${proj.workspace_id}:${proj.project_id}`,
                name: proj.project_name,
                isActive:
                    proj.project_id === currentProject?.project_id &&
                    proj.workspace_id === currentProject?.workspace_id,
                onSelect: () => switchProject(proj),
            })),
        [projectsForOrg, currentProject?.project_id, currentProject?.workspace_id, switchProject],
    )

    const orgs = useMemo<SwitcherEntry[]>(
        () =>
            orgOptions.map((org) => ({
                key: org.id,
                name: org.name,
                isActive: org.id === currentOrg?.id,
                onSelect: () => void switchOrg(org.id),
            })),
        [orgOptions, currentOrg?.id, switchOrg],
    )

    return (
        <>
            <ProjectOrgSwitcherView
                collapsed={collapsed}
                projectLabel={currentProject?.project_name || "Select project"}
                orgLabel={currentOrg?.name || "Organization"}
                projects={projects}
                orgs={orgs}
                onCreateProject={() => createProject.setOpen(true)}
                onCreateOrg={() => createOrg.setOpen(true)}
                theme={theme}
                onOrgSettings={goToOrgSettings}
                onLogout={confirmLogout}
            />
            <NamePromptModal
                title="Create project"
                label="Project name"
                placeholder="Project name"
                open={createProject.open}
                onCancel={() => createProject.setOpen(false)}
                onSubmit={createProject.submit}
                isPending={createProject.isPending}
            />
            <NamePromptModal
                title="Create organization"
                label="Name"
                placeholder="Organization name"
                open={createOrg.open}
                onCancel={() => createOrg.setOpen(false)}
                onSubmit={createOrg.submit}
                isPending={createOrg.isPending}
            />
        </>
    )
}

export default memo(ProjectOrgSwitcher)
