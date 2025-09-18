/**
 * Table-Optimized Environment Atoms
 *
 * Specialized atoms for table/list views with:
 * - Minimal data transformation overhead
 * - Table-specific data structures
 * - Performance-optimized rendering
 * - Memory-efficient operations
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {Environment} from "@/oss/lib/Types"

import {environmentsAtom, environmentsLoadingAtom, environmentsErrorAtom} from "./environments"

// ============================================================================
// Table Data Types
// ============================================================================

export interface EnvironmentTableRow {
    id: string // environment name as unique identifier
    name: string
    appId: string
    deployedVariantId: string | null
    deployedVariantName: string | null
    deployedRevisionId: string | null
    revision: string | null
    isDeployed: boolean
    deploymentStatus: "deployed" | "empty" | "unknown"
    lastDeployment: string | null
}

export interface EnvironmentTableData {
    rows: EnvironmentTableRow[]
    totalCount: number
    deployedCount: number
    emptyCount: number
    loading: boolean
    error: string | null
}

export interface EnvironmentTableStats {
    total: number
    deployed: number
    empty: number
    deploymentRate: number
    hasData: boolean
    isEmpty: boolean
}

// ============================================================================
// Table Row Transformation
// ============================================================================

/**
 * Transform environment data into table-optimized rows
 */
const transformEnvironmentToTableRow = (env: Environment): EnvironmentTableRow => {
    const isDeployed = !!(env.deployed_app_variant_id && env.deployed_variant_name)

    return {
        id: env.name,
        name: env.name,
        appId: env.app_id,
        deployedVariantId: env.deployed_app_variant_id,
        deployedVariantName: env.deployed_variant_name,
        deployedRevisionId: env.deployed_app_variant_revision_id,
        revision: env.revision,
        isDeployed,
        deploymentStatus: isDeployed ? "deployed" : "empty",
        lastDeployment: env.revision, // Using revision as deployment timestamp proxy
    }
}

// ============================================================================
// Table Atoms
// ============================================================================

/**
 * Table-optimized environment rows atom
 * Transforms environments into table-friendly format
 */
export const environmentTableRowsAtom = selectAtom(
    environmentsAtom,
    (environments): EnvironmentTableRow[] => environments.map(transformEnvironmentToTableRow),
    deepEqual,
)

/**
 * Complete table data atom with metadata
 */
export const environmentTableDataAtom = atom<EnvironmentTableData>((get) => {
    const rows = get(environmentTableRowsAtom)
    const loading = get(environmentsLoadingAtom)
    const error = get(environmentsErrorAtom)

    const totalCount = rows.length
    const deployedCount = rows.filter((row) => row.isDeployed).length
    const emptyCount = totalCount - deployedCount

    return {
        rows,
        totalCount,
        deployedCount,
        emptyCount,
        loading,
        error: error?.message || null,
    }
})

/**
 * Table statistics atom for quick metrics
 */
export const environmentTableStatsAtom = selectAtom(
    environmentTableDataAtom,
    (tableData): EnvironmentTableStats => ({
        total: tableData.totalCount,
        deployed: tableData.deployedCount,
        empty: tableData.emptyCount,
        deploymentRate:
            tableData.totalCount > 0 ? (tableData.deployedCount / tableData.totalCount) * 100 : 0,
        hasData: tableData.totalCount > 0,
        isEmpty: tableData.totalCount === 0,
    }),
    deepEqual,
)

/**
 * Deployed environments only (for deployment-focused views)
 */
export const deployedEnvironmentRowsAtom = selectAtom(
    environmentTableRowsAtom,
    (rows) => rows.filter((row) => row.isDeployed),
    deepEqual,
)

/**
 * Empty environments only (for deployment opportunities)
 */
export const emptyEnvironmentRowsAtom = selectAtom(
    environmentTableRowsAtom,
    (rows) => rows.filter((row) => !row.isDeployed),
    deepEqual,
)

/**
 * Environment rows grouped by deployment status
 */
export const environmentRowsByStatusAtom = selectAtom(
    environmentTableRowsAtom,
    (rows) => {
        const deployed: EnvironmentTableRow[] = []
        const empty: EnvironmentTableRow[] = []

        rows.forEach((row) => {
            if (row.isDeployed) {
                deployed.push(row)
            } else {
                empty.push(row)
            }
        })

        return {deployed, empty}
    },
    deepEqual,
)

/**
 * Environment table search/filter atom
 * Filters rows by name or deployment status
 */
export const environmentTableFilterAtom = atom("")

export const filteredEnvironmentRowsAtom = atom<EnvironmentTableRow[]>((get) => {
    const rows = get(environmentTableRowsAtom)
    const filter = get(environmentTableFilterAtom).toLowerCase().trim()

    if (!filter) return rows

    return rows.filter(
        (row) =>
            row.name.toLowerCase().includes(filter) ||
            row.deployedVariantName?.toLowerCase().includes(filter) ||
            row.deploymentStatus.includes(filter),
    )
})

/**
 * Paginated table data atom for large environment lists
 */
export const environmentTablePageSizeAtom = atom(10)
export const environmentTableCurrentPageAtom = atom(0)

export const paginatedEnvironmentRowsAtom = atom<{
    rows: EnvironmentTableRow[]
    totalPages: number
    currentPage: number
    hasNextPage: boolean
    hasPrevPage: boolean
}>((get) => {
    const allRows = get(filteredEnvironmentRowsAtom)
    const pageSize = get(environmentTablePageSizeAtom)
    const currentPage = get(environmentTableCurrentPageAtom)

    const totalPages = Math.ceil(allRows.length / pageSize)
    const startIndex = currentPage * pageSize
    const endIndex = startIndex + pageSize
    const rows = allRows.slice(startIndex, endIndex)

    return {
        rows,
        totalPages,
        currentPage,
        hasNextPage: currentPage < totalPages - 1,
        hasPrevPage: currentPage > 0,
    }
})
