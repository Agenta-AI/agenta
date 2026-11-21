import {useCallback, useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import {loadWithText} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import createProjectCatalog from "@agenta/i18n/catalogs/shell.createProject"
import {
    ProjectOrgSwitcherView,
    SidebarIconMenu,
    type SwitcherEntry,
    type SwitcherThemeControl,
} from "@agenta/navigation-ui"
import {message} from "@agenta/ui/app-message"
import {KeyboardShortcutsSheet} from "@agenta/ui/shortcuts"
import {themeIcon, useThemeMode, useThemeOptions} from "@agenta/ui/theme"
import {useMutation} from "@tanstack/react-query"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {useLogout} from "../auth/useLogout"
import {switchSettingsContext} from "../settings/switchContext"
import {LiveChatNavButton} from "../support/LiveChatNavButton"
import {useLiveChatEnabled} from "../support/useLiveChatEnabled"

import {useMobileHelpItem} from "./useMobileNavItems"
import {useOrganizationProjects} from "./useOrganizationProjects"

/** Opens from a menu row, so the dialog and its text load on first use. */
const CreateProjectSheet = dynamic(
    () => loadWithText(() => import("./CreateProjectSheet")).then((m) => m.CreateProjectSheet),
    {ssr: false},
)

/**
 * The drawer's header switcher: the desktop rail's component, bound to mobile's project data.
 * Both panels speak organizations, because every org's workspace is named "Default".
 */
export const DrawerProjectSwitcher = ({
    workspaceId,
    projectId,
    collapsed = false,
}: {
    workspaceId: string
    projectId: string
    /** The rail's state. False in the drawer, which never collapses. */
    collapsed?: boolean
}) => {
    const t = useT(navigationCatalog, commonCatalog, createProjectCatalog)
    const router = useRouter()
    const logout = useLogout()
    // The sheet is a modal, so its state lives with whatever stays mounted after the menu closes.
    const [shortcutsOpen, setShortcutsOpen] = useState(false)
    // Help rides on the switcher row rather than taking a nav row of its own, as on the desktop.
    const helpItem = useMobileHelpItem({
        onOpenShortcuts: useCallback(() => setShortcutsOpen(true), []),
    })
    const liveChatEnabled = useLiveChatEnabled(projectId)
    const {query, groups, currentGroup, currentProject} = useOrganizationProjects(
        workspaceId,
        projectId,
    )

    const goTo = (nextWorkspaceId: string, nextProjectId: string) =>
        switchSettingsContext(router, {workspaceId: nextWorkspaceId, projectId: nextProjectId})

    const projects = useMemo<SwitcherEntry[]>(
        () =>
            (currentGroup?.projects ?? []).map((project) => ({
                key: project.project_id,
                name: project.project_name ?? t("common.project"),
                isActive: project.project_id === projectId,
                onSelect: () => goTo(project.workspace_id, project.project_id),
            })),

        [currentGroup?.projects, projectId, t],
    )

    const organizations = useMemo<SwitcherEntry[]>(
        () =>
            groups.map((group) => ({
                key: group.key,
                name: group.organizationName,
                isActive: group.key === currentGroup?.key,
                // Entering an org lands on its first project; the project panel then narrows.
                onSelect: () => {
                    const first = group.projects[0]
                    if (first) goTo(group.workspaceId, first.project_id)
                },
            })),

        [groups, currentGroup?.key],
    )

    const [createOpen, setCreateOpen] = useState(false)
    // Same shared mutation the desktop rail calls; the row it feeds is already in the shared
    // view, gated on `onCreateProject`, and was invisible here only because nothing passed it.
    const createProject = useMutation({
        mutationFn: async (name: string) => {
            const {createProject: create} = await import("@agenta/entities/project")
            return create({name: name.trim()}, workspaceId)
        },
        // Creating a project is a switch into it, exactly like picking one from the list.
        onSuccess: async (created) => {
            setCreateOpen(false)
            // Refetch first: the destination reads this same query for its title.
            await query.refetch()
            goTo(created.organization_id ?? created.workspace_id ?? workspaceId, created.project_id)
        },
        // The API's refusal is written for people (e.g. the plan's project limit).
        onError: (error) => {
            const detail = (error as {response?: {data?: {detail?: unknown}}})?.response?.data
                ?.detail
            message.error(typeof detail === "string" ? detail : t("shell.createProject.failed"))
        },
    })

    // Inside the nav drawer the panel must portal into the sheet or it renders behind it. In the
    // docked rail there is no sheet, and portalling into this wrapper put the 220px panel inside a
    // 48px `overflow-y-auto` column, which cropped it to a sliver — so there, use the body.
    const [panelContainer, setPanelContainer] = useState<HTMLElement | null>(null)
    const anchorRef = useCallback(
        (node: HTMLDivElement | null) =>
            setPanelContainer(node?.closest<HTMLElement>('[data-slot="sheet-content"]') ?? null),
        [],
    )

    // The same fly-out the desktop rail carries, over the same three choices — Preferences offers
    // them too, but the switcher is where you already are when you want to flip the lights.
    const {themeMode, setMode} = useThemeMode()
    const themeOptions = useThemeOptions()
    const theme = useMemo<SwitcherThemeControl>(
        () => ({
            mode: themeMode,
            onSelect: (mode) => setMode(mode as typeof themeMode),
            options: themeOptions.map(({mode, label, short}) => ({
                mode,
                label,
                short,
                icon: themeIcon(mode),
            })),
        }),
        [themeMode, setMode, themeOptions],
    )

    return (
        <div ref={anchorRef}>
            <ProjectOrgSwitcherView
                panelContainer={panelContainer}
                collapsed={collapsed}
                projectLabel={
                    currentProject?.project_name ?? t("navigation.projectMenu.selectProject")
                }
                orgLabel={
                    currentGroup?.organizationName ?? t("navigation.settings.scopeOrganization")
                }
                projects={projects}
                orgs={organizations}
                theme={theme}
                onCreateProject={() => setCreateOpen(true)}
                onLogout={() => void logout()}
                trailing={
                    <>
                        {liveChatEnabled ? <LiveChatNavButton /> : null}
                        <SidebarIconMenu item={helpItem} />
                    </>
                }
            />
            <KeyboardShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
            <CreateProjectSheet
                open={createOpen}
                onOpenChange={setCreateOpen}
                onSubmit={(name) => createProject.mutate(name)}
                isPending={createProject.isPending}
            />
        </div>
    )
}
