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
import {groupByOrganization} from "../context/workspaceGroups"

/**
 * The drawer's header switcher — the same designed component as the desktop rail, bound to
 * mobile's project data.
 *
 * Both panels speak ORGANIZATIONS, as the desktop does. Listing workspaces instead rendered one
 * indistinguishable "Default" row per org — every org's default workspace carries that name — so
 * a multi-org account had no way to tell the rows apart. The workspace stays in the URL
 * (`/w/:id/p/:id`); each project row routes with its OWN workspace id.
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
        () => (query.data?.kind === "ok" ? groupByOrganization(query.data.projects) : []),
        [query.data],
    )

    // Resolve by the project in the URL: an org can hold several workspaces, and the workspace
    // alone would not name the org on a route the switcher did not build.
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
                orgs={organizations}
                orgNoun="organization"
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
