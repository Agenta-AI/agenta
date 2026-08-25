import {useMemo, useState} from "react"

import {
    NamePromptModal,
    ProjectOrgSwitcherView,
    type SwitcherEntry,
    type SwitcherThemeControl,
} from "@agenta/navigation-ui"
import {THEME_OPTIONS, themeIcon, useThemeMode} from "@agenta/ui/theme"
import {useMutation, useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {fetchProjects, writeLastContext} from "@/lib/context"

import {useLogout} from "../auth/useLogout"
import {groupByWorkspace} from "../context/workspaceGroups"

/**
 * The drawer's header switcher — the same designed component as the desktop rail, bound to
 * mobile's workspace/project data.
 *
 * The trigger names the ORGANIZATION, as the desktop does. Labelling it by workspace read
 * "Default" on every account whose projects sit in the one default workspace, which is all of
 * them; the org is the name a person recognises. The second panel still moves between
 * workspaces, which is the routable unit here (`/w/:id/p/:id`).
 */
export const DrawerProjectSwitcher = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const router = useRouter()
    const logout = useLogout()
    const query = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        staleTime: 30_000,
    })
    const groups = useMemo(
        () => (query.data?.kind === "ok" ? groupByWorkspace(query.data.projects) : []),
        [query.data],
    )

    const currentGroup = groups.find((group) => group.workspaceId === workspaceId)
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
                onSelect: () => goTo(workspaceId, project.project_id),
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [currentGroup?.projects, projectId, workspaceId],
    )

    const workspaces = useMemo<SwitcherEntry[]>(
        () =>
            groups.map((group) => ({
                key: group.workspaceId,
                name: group.workspaceName,
                isActive: group.workspaceId === workspaceId,
                // Entering a workspace lands on its first project; the drawer's project panel
                // then narrows within it.
                onSelect: () => {
                    const first = group.projects[0]
                    if (first) goTo(group.workspaceId, first.project_id)
                },
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [groups, workspaceId],
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

    const [panelContainer, setPanelContainer] = useState<HTMLElement | null>(null)

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
        <div ref={setPanelContainer}>
            <ProjectOrgSwitcherView
                panelContainer={panelContainer}
                collapsed={false}
                projectLabel={currentProject?.project_name ?? "Select project"}
                orgLabel={currentGroup?.organizationName ?? "Organization"}
                projects={projects}
                orgs={workspaces}
                orgNoun="workspace"
                theme={theme}
                onCreateProject={() => setCreateOpen(true)}
                onLogout={() => void logout()}
            />
            <NamePromptModal
                title="Create project"
                label="Project name"
                placeholder="Project name"
                open={createOpen}
                onCancel={() => setCreateOpen(false)}
                onSubmit={(name) => createProject.mutate(name)}
                isPending={createProject.isPending}
            />
        </div>
    )
}
