/**
 * Project Skeleton Atoms - Loading State Management
 *
 * This module provides skeleton loading states for project components,
 * following the established patterns from newApps, newVariants, newEnvironments,
 * newOrg, newProfile, and newWorkspace.
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {ProjectsResponse} from "@/oss/services/project/types"

// ============================================================================
// Skeleton Data Generation
// ============================================================================

/**
 * Generate skeleton project data
 */
const generateSkeletonProject = (index: number): ProjectsResponse => ({
    project_id: `skeleton-project-${index}`,
    project_name: `Project ${index + 1}`,
    workspace_id: `skeleton-workspace-${index}`,
    user_id: `skeleton-user-${index}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
})

// ============================================================================
// Skeleton Configuration
// ============================================================================

/**
 * Skeleton configuration atom
 */
export const projectSkeletonConfigAtom = atom({
    projectCount: 3,
    showSkeleton: true,
    animationDelay: 150,
})

// ============================================================================
// Project Skeleton Atoms
// ============================================================================

/**
 * Projects skeleton data atom
 */
export const projectsSkeletonAtom = selectAtom(
    projectSkeletonConfigAtom,
    (config): ProjectsResponse[] => {
        if (!config.showSkeleton) return []

        return Array.from({length: config.projectCount}, (_, index) =>
            generateSkeletonProject(index),
        )
    },
    deepEqual,
)

/**
 * Current project skeleton atom
 */
export const currentProjectSkeletonAtom = selectAtom(
    projectsSkeletonAtom,
    (skeletonProjects): ProjectsResponse | null => {
        return skeletonProjects[0] || null
    },
    deepEqual,
)

/**
 * Project selector skeleton options atom
 */
export const projectSelectorSkeletonAtom = selectAtom(
    projectsSkeletonAtom,
    (skeletonProjects): {value: string; label: string; project: ProjectsResponse}[] =>
        skeletonProjects.map((project) => ({
            value: project.project_id,
            label: project.project_name,
            project,
        })),
    deepEqual,
)

/**
 * Project map skeleton atom
 */
export const projectMapSkeletonAtom = selectAtom(
    projectsSkeletonAtom,
    (skeletonProjects): Record<string, ProjectsResponse> => {
        const map: Record<string, ProjectsResponse> = {}
        skeletonProjects.forEach((project) => {
            map[project.project_id] = project
        })
        return map
    },
    deepEqual,
)

/**
 * Filtered projects skeleton atom
 */
export const filteredProjectsSkeletonAtom = selectAtom(
    projectsSkeletonAtom,
    (skeletonProjects) => skeletonProjects,
    deepEqual,
)

// ============================================================================
// Project Statistics Skeleton Atoms
// ============================================================================

/**
 * Project stats skeleton atom
 */
export const projectStatsSkeletonAtom = atom({
    totalProjects: 0,
    hasProjects: false,
    hasCurrentProject: false,
    currentProjectId: null,
    currentProjectName: null,
    workspaceId: null,
    loading: true,
    skeleton: true,
    recommendations: {
        shouldCreateProject: false,
        hasMultipleProjects: false,
        needsProjectSelection: false,
    },
})

// ============================================================================
// Skeleton Control Atoms
// ============================================================================

/**
 * Project skeleton visibility atom
 */
export const projectSkeletonVisibilityAtom = atom(
    (get) => get(projectSkeletonConfigAtom).showSkeleton,
    (get, set, show: boolean) => {
        const config = get(projectSkeletonConfigAtom)
        set(projectSkeletonConfigAtom, {
            ...config,
            showSkeleton: show,
        })
    },
)

/**
 * Project skeleton count atom
 */
export const projectSkeletonCountAtom = atom(
    (get) => get(projectSkeletonConfigAtom).projectCount,
    (get, set, count: number) => {
        const config = get(projectSkeletonConfigAtom)
        set(projectSkeletonConfigAtom, {
            ...config,
            projectCount: Math.max(1, Math.min(10, count)),
        })
    },
)

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a project is skeleton data
 */
export const isSkeletonProject = (project: ProjectsResponse | null): boolean => {
    return project?.project_id.startsWith("skeleton-project-") || false
}

/**
 * Filter out skeleton projects
 */
export const filterSkeletonProjects = (projects: ProjectsResponse[]): ProjectsResponse[] => {
    return projects.filter((project) => !isSkeletonProject(project))
}
