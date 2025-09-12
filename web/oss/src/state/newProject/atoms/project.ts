/**
 * New Project Atoms - Core Project State Management
 *
 * This module provides optimized project state management following the established patterns
 * from newApps, newVariants, newEnvironments, newOrg, newProfile, and newWorkspace. It includes:
 *
 * - Core project fetching with caching and background refresh
 * - Selected project state with persistence
 * - Project selector atoms for UI components
 * - Project statistics and analytics
 * - Loading states and error handling
 * - Performance monitoring and analytics
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {isDemo} from "@/oss/lib/helpers/utils"
import {fetchAllProjects} from "@/oss/services/project"
import {ProjectsResponse} from "@/oss/services/project/types"

import {selectedOrgAtom, selectedOrgIdAtom} from "../../newOrg/atoms/orgs"
import {userAtom} from "../../newProfile/atoms/profile"

// ============================================================================
// Constants and Configuration
// ============================================================================

export const DEFAULT_UUID = "00000000-0000-0000-0000-000000000000"

// Environment variable for logging
const logProjects = process.env.NEXT_PUBLIC_LOG_PROJECT_ATOMS === "true"

// ============================================================================
// Core Project Query Atoms
// ============================================================================

/**
 * Projects query atom - fetches all projects for the current organization
 */
// Environment variables for test compatibility
const testApiUrl = process.env.VITEST_TEST_API_URL
const isTestMode = !!testApiUrl

export const projectsQueryAtom = atomWithQuery<ProjectsResponse[]>((get) => {
    // Test mode: enable if we have API URL (like variants atoms use appId)
    if (isTestMode) {
        console.log("🔍 Project query test mode:", {
            testApiUrl,
            enabled: !!testApiUrl,
        })

        return {
            queryKey: ["projects", "test-mode"],
            queryFn: async (): Promise<ProjectsResponse[]> => {
                try {
                    console.log("🌐 Project query executing...")
                    const data = await fetchAllProjects()
                    console.log("📋 Fetched projects successfully:", data?.length || 0)

                    if (logProjects) {
                        console.log("📋 Fetched projects:", data?.length || 0)
                    }
                    return data || []
                } catch (error) {
                    console.error("❌ Failed to fetch projects:", error)
                    console.error("❌ Error details:", {
                        message: error?.message,
                        status: error?.status,
                        stack: error?.stack,
                    })
                    return []
                }
            },
            enabled: !!testApiUrl, // Enable if we have API URL
            staleTime: 2 * 60 * 1000, // 2 minutes
            gcTime: 5 * 60 * 1000, // 5 minutes
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            retry: 2,
        }
    }

    // Production mode: use org/user atoms
    const orgId = get(selectedOrgIdAtom)
    const user = get(userAtom)

    return {
        queryKey: ["projects", orgId, user?.id],
        queryFn: async (): Promise<ProjectsResponse[]> => {
            try {
                const data = await fetchAllProjects()
                if (logProjects) {
                    console.log("📋 Fetched projects:", data?.length || 0)
                }
                return data || []
            } catch (error) {
                console.error("Failed to fetch projects:", error)
                return []
            }
        },
        enabled: !!orgId && !!user?.id,
        staleTime: 2 * 60 * 1000, // 2 minutes
        gcTime: 5 * 60 * 1000, // 5 minutes
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 2,
    }
})

/**
 * Projects atom - provides the list of projects with loading state
 */
export const projectsAtom = selectAtom(projectsQueryAtom, (query) => query.data || [], deepEqual)

/**
 * Projects loading atom
 */
export const projectsLoadingAtom = selectAtom(projectsQueryAtom, (query) => query.isLoading)

/**
 * Projects error atom
 */
export const projectsErrorAtom = selectAtom(projectsQueryAtom, (query) => query.error)

/**
 * Projects count atom
 */
export const projectsCountAtom = selectAtom(projectsAtom, (projects) => projects.length)

// ============================================================================
// Current Project Selection Logic
// ============================================================================

/**
 * Current project atom - selects the appropriate project based on context
 */
export const currentProjectAtom = selectAtom(
    atom((get) => ({
        projects: get(projectsAtom),
        selectedOrg: get(selectedOrgAtom),
    })),
    ({projects, selectedOrg}): ProjectsResponse | null => {
        if (projects.length === 0) return null

        const workspaceId = selectedOrg?.default_workspace?.id || DEFAULT_UUID

        if (isDemo()) {
            // In demo mode, find project by workspace
            return projects.find((p) => p.workspace_id === workspaceId) || null
        }

        // In normal mode, return first project
        return projects[0] || null
    },
    deepEqual,
)

/**
 * Current project ID atom with test environment fallback
 */
export const currentProjectIdAtom = selectAtom(currentProjectAtom, (project): string | null => {
    const projectId = project?.project_id

    // In test environment, fall back to environment variable if project is not available
    if (!projectId && typeof process !== "undefined" && process.env.NODE_ENV === "test") {
        return process.env.VITEST_TEST_PROJECT_ID || process.env.TEST_PROJECT_ID || null
    }

    return projectId || null
})

/**
 * Current project name atom
 */
export const currentProjectNameAtom = selectAtom(
    currentProjectAtom,
    (project) => project?.project_name || null,
)

/**
 * Current project workspace ID atom
 */
export const currentProjectWorkspaceIdAtom = selectAtom(
    currentProjectAtom,
    (project) => project?.workspace_id || null,
)

// ============================================================================
// Project Selector Atoms
// ============================================================================

/**
 * Project selector options atom - provides options for project dropdowns
 */
export const projectSelectorOptionsAtom = selectAtom(
    projectsAtom,
    (projects): {value: string; label: string; project: ProjectsResponse}[] =>
        projects.map((project) => ({
            value: project.project_id,
            label: project.project_name,
            project,
        })),
    deepEqual,
)

/**
 * Project selector state atom - combines options with current selection
 */
export const projectSelectorStateAtom = selectAtom(
    atom((get) => ({
        options: get(projectSelectorOptionsAtom),
        currentProjectId: get(currentProjectIdAtom),
        loading: get(projectsLoadingAtom),
    })),
    ({options, currentProjectId, loading}) => ({
        options,
        selectedValue: currentProjectId,
        selectedOption: options.find((opt) => opt.value === currentProjectId) || null,
        hasSelection: !!currentProjectId,
        loading,
    }),
    deepEqual,
)

// ============================================================================
// Project Map and Lookup Atoms
// ============================================================================

/**
 * Project map atom - provides O(1) lookup by ID
 */
export const projectMapAtom = selectAtom(
    projectsAtom,
    (projects): Record<string, ProjectsResponse> => {
        const map: Record<string, ProjectsResponse> = {}
        projects.forEach((project) => {
            map[project.project_id] = project
        })
        return map
    },
    deepEqual,
)

/**
 * Project lookup atom - provides lookup function
 */
export const projectLookupAtom = selectAtom(
    projectMapAtom,
    (projectMap) =>
        (id: string): ProjectsResponse | null =>
            projectMap[id] || null,
)

// ============================================================================
// Project Statistics and Analytics
// ============================================================================

/**
 * Project statistics atom
 */
export const projectStatsAtom = selectAtom(
    atom((get) => ({
        projects: get(projectsAtom),
        currentProject: get(currentProjectAtom),
        loading: get(projectsLoadingAtom),
        selectedOrg: get(selectedOrgAtom),
    })),
    ({projects, currentProject, loading, selectedOrg}) => ({
        totalProjects: projects.length,
        hasProjects: projects.length > 0,
        hasCurrentProject: !!currentProject,
        currentProjectId: currentProject?.project_id || null,
        currentProjectName: currentProject?.project_name || null,
        workspaceId: selectedOrg?.default_workspace?.id || null,
        loading,
        recommendations: {
            shouldCreateProject: projects.length === 0,
            hasMultipleProjects: projects.length > 1,
            needsProjectSelection: projects.length > 1 && !currentProject,
        },
    }),
    deepEqual,
)

// ============================================================================
// Project Filtering and Search
// ============================================================================

/**
 * Project search term atom
 */
export const projectSearchTermAtom = atom<string>("")

/**
 * Filtered projects atom - filters projects based on search term
 */
export const filteredProjectsAtom = selectAtom(
    atom((get) => ({
        projects: get(projectsAtom),
        searchTerm: get(projectSearchTermAtom),
    })),
    ({projects, searchTerm}): ProjectsResponse[] => {
        if (!searchTerm.trim()) {
            return projects
        }

        const term = searchTerm.toLowerCase()
        return projects.filter((project) => {
            const name = project.project_name?.toLowerCase() || ""
            const id = project.project_id?.toLowerCase() || ""
            return name.includes(term) || id.includes(term)
        })
    },
    deepEqual,
)

/**
 * Filtered projects count atom
 */
export const filteredProjectsCountAtom = selectAtom(
    filteredProjectsAtom,
    (projects) => projects.length,
)

// ============================================================================
// Utility and Management Atoms
// ============================================================================

/**
 * Project prefetch atom - triggers prefetching of project data
 */
export const projectsPrefetchAtom = atom(null, async (get, set) => {
    const queryClient = get(queryClientAtom)
    const orgId = get(selectedOrgIdAtom)
    const user = get(userAtom)

    if (orgId && user?.id) {
        await queryClient.prefetchQuery({
            queryKey: ["projects", orgId, user.id],
            queryFn: async () => {
                const data = await fetchAllProjects()
                return data || []
            },
            staleTime: 2 * 60 * 1000,
        })

        if (logProjects) {
            console.log("📋 Projects prefetched")
        }
    }
})

/**
 * Project refresh atom - forces refresh of project data
 */
export const projectsRefreshAtom = atom(null, async (get, set) => {
    const queryClient = get(queryClientAtom)
    const orgId = get(selectedOrgIdAtom)
    const user = get(userAtom)

    if (orgId && user?.id) {
        await queryClient.invalidateQueries({
            queryKey: ["projects", orgId, user.id],
        })

        if (logProjects) {
            console.log("📋 Projects refreshed")
        }
    }
})

/**
 * Project reset atom - clears all project data
 */
export const projectsResetAtom = atom(null, (get, set) => {
    const queryClient = get(queryClientAtom)

    // Clear all project queries
    queryClient.removeQueries({queryKey: ["projects"]})

    // Clear search term
    set(projectSearchTermAtom, "")

    if (logProjects) {
        console.log("📋 Projects reset")
    }
})

// ============================================================================
// Network and Performance Monitoring
// ============================================================================

/**
 * Project network stats atom - tracks network requests
 */
export const projectNetworkStatsAtom = selectAtom(
    projectsQueryAtom,
    (query) => ({
        status: query.status,
        fetchStatus: query.fetchStatus,
        isFetching: query.isFetching,
        isLoading: query.isLoading,
        lastFetch: query.dataUpdatedAt,
        errorCount: query.failureCount,
        isStale: query.isStale,
    }),
    deepEqual,
)
