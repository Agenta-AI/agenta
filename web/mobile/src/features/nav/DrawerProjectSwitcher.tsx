import {useCallback, useMemo, useState} from "react"

import {
    ProjectOrgSwitcherView,
    SidebarIconMenu,
    type SwitcherEntry,
    type SwitcherThemeControl,
} from "@agenta/navigation-ui"
import {KeyboardShortcutsSheet} from "@agenta/ui/shortcuts"
import {THEME_OPTIONS, themeIcon, useThemeMode} from "@agenta/ui/theme"
import {useMutation, useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {fetchProjects, writeLastContext} from "@/lib/context"

import {useLogout} from "../auth/useLogout"
import {groupByOrganization} from "../context/workspaceGroups"

import {CreateProjectSheet} from "./CreateProjectSheet"
import {useMobileHelpItem} from "./useMobileNavItems"

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
    const router = useRouter()
    const logout = useLogout()
    // The sheet is a modal, so its state lives with whatever stays mounted after the menu closes.
    const [shortcutsOpen, setShortcutsOpen] = useState(false)
    // Help rides on the switcher row rather than taking a nav row of its own, as on the desktop.
    const helpItem = useMobileHelpItem({
        onOpenShortcuts: useCallback(() => setShortcutsOpen(true), []),
    })
    const query = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        staleTime: 30_000,
    })
    const groups = useMemo(
        () => (query.data?.kind === "ok" ? groupByOrganization(query.data.projects) : []),
        [query.data],
    )

    // Matched on the project, not the workspace: one org can hold several workspaces.
    const currentGroup =
        groups.find((group) =>
            group.projects.some(
                (project) =>
                    project.project_id === projectId && project.workspace_id === workspaceId,
            ),
        ) ?? groups.find((group) => group.projects.some((p) => p.workspace_id === workspaceId))
    const currentProject = currentGroup?.projects.find(
        (project) => project.project_id === projectId,
    )

    const goTo = (nextWorkspaceId: string, nextProjectId: string) => {
        writeLastContext({workspaceId: nextWorkspaceId, projectId: nextProjectId})
        void router.push(`/w/${nextWorkspaceId}/p/${nextProjectId}/apps`)
    }

    const projects = useMemo<SwitcherEntry[]>(
        () =>
            (currentGroup?.projects ?? []).map((project) => ({
                key: project.project_id,
                name: project.project_name ?? "Project",
                isActive: project.project_id === projectId,
                onSelect: () => goTo(project.workspace_id, project.project_id),
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [currentGroup?.projects, projectId],
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        onSuccess: async () => {
            setCreateOpen(false)
            await query.refetch()
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
    const theme = useMemo<SwitcherThemeControl>(
        () => ({
            mode: themeMode,
            onSelect: (mode) => setMode(mode as typeof themeMode),
            options: THEME_OPTIONS.map(({mode, label, short}) => ({
                mode,
                label,
                short,
                icon: themeIcon(mode),
            })),
        }),
        [themeMode, setMode],
    )

    return (
        <div ref={anchorRef}>
            <ProjectOrgSwitcherView
                panelContainer={panelContainer}
                collapsed={collapsed}
                projectLabel={currentProject?.project_name ?? "Select project"}
                orgLabel={currentGroup?.organizationName ?? "Organization"}
                projects={projects}
                orgs={organizations}
                orgNoun="organization"
                theme={theme}
                onCreateProject={() => setCreateOpen(true)}
                onLogout={() => void logout()}
                trailing={<SidebarIconMenu item={helpItem} />}
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
