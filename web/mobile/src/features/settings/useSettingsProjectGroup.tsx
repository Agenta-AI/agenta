import {useMemo, type ReactNode} from "react"

import {ProjectSwitch, type SwitcherEntry} from "@agenta/navigation-ui"
import {useRouter} from "next/router"

import {switchProjectContext} from "../context/switchProjectContext"
import {useOrganizationProjects} from "../nav/useOrganizationProjects"

export interface SettingsProjectGroup {
    /** The project group's heading: the project name as the project switch. */
    projectSwitch?: ReactNode
    projectName?: string
    /** How many projects the person has in this organization. */
    projectCount?: number
}

/** A Settings page's project group heading (the project switch) and names, from the sidebar's query. */
export const useSettingsProjectGroup = (
    workspaceId: string,
    projectId: string,
): SettingsProjectGroup => {
    const router = useRouter()
    const {currentGroup, currentProject} = useOrganizationProjects(workspaceId, projectId)

    return useMemo(() => {
        if (!currentGroup || !currentProject) return {}
        const projects: SwitcherEntry[] = currentGroup.projects.map((project) => ({
            key: project.project_id,
            name: project.project_name ?? "Project",
            isActive: project.project_id === projectId,
            onSelect: () =>
                switchProjectContext(router, {
                    workspaceId: project.workspace_id,
                    projectId: project.project_id,
                }),
        }))
        const projectName = currentProject.project_name ?? "Project"
        return {
            projectSwitch: (
                <ProjectSwitch
                    label={projectName}
                    orgLabel={currentGroup.organizationName}
                    projects={projects}
                />
            ),
            projectName,
            projectCount: currentGroup.projects.length,
        }
    }, [currentGroup, currentProject, projectId, router])
}
