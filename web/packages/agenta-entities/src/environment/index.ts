/**
 * Environment Entity Module
 *
 * Provides molecules and utilities for managing environment entities.
 * Based on the new git-based environments API (PR #3627).
 *
 * ## Overview
 *
 * This module exports:
 * - **Molecules** - Unified state management for environment entities
 * - **Schemas** - Zod schemas for validation
 * - **API functions** - HTTP functions for fetching and mutating data
 * - **Types** - TypeScript interfaces
 *
 * ## Quick Start
 *
 * ```typescript
 * import { environmentMolecule } from '@agenta/entities/environment'
 *
 * // Reactive atoms (for useAtomValue, atom compositions)
 * const data = useAtomValue(environmentMolecule.data(envId))
 * const isDirty = useAtomValue(environmentMolecule.isDirty(envId))
 *
 * // Write atoms (for use in other atoms with set())
 * set(environmentMolecule.actions.deploy, deployParams)
 * set(environmentMolecule.actions.toggleGuard, { projectId, environmentId, guard: true })
 *
 * // Imperative API (for callbacks outside React/atom context)
 * const data = environmentMolecule.get.data(envId)
 * const envBySlug = environmentMolecule.get.bySlug('production')
 * ```
 */

// ============================================================================
// MOLECULES (Primary API)
// ============================================================================

export {
    environmentMolecule,
    invalidateEnvironmentsListCache,
    invalidateEnvironmentCache,
    type EnvironmentMolecule,
    type RevertDeploymentParams,
    type RevertToSnapshotParams,
} from "./state/environmentMolecule"

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

export {
    // Reference
    referenceSchema,
    type Reference,
    // Environment revision data
    environmentRevisionDataSchema,
    type EnvironmentRevisionData,
    // Flags
    environmentFlagsSchema,
    type EnvironmentFlags,
    // Environment (SimpleEnvironment)
    environmentSchema,
    type Environment,
    // Environment revision
    environmentRevisionSchema,
    type EnvironmentRevision,
    environmentRevisionListItemSchema,
    type EnvironmentRevisionListItem,
    // Response schemas
    environmentsResponseSchema,
    type EnvironmentsResponse,
    environmentResponseSchema,
    type EnvironmentResponse,
    environmentRevisionsResponseSchema,
    type EnvironmentRevisionsResponse,
    environmentRevisionResponseSchema,
    type EnvironmentRevisionResponse,
    // Normalization
    normalizeEnvironment,
    normalizeEnvironmentRevision,
    // Utilities
    getDeployedRevisionId,
    getDeployedAppKeys,
    isGuardedEnvironment,
} from "./core"

export type {
    // API parameter types
    EnvironmentListParams,
    EnvironmentDetailParams,
    EnvironmentRevisionListParams,
    EnvironmentRevisionDetailParams,
    EnvironmentRevisionDelta,
    EnvironmentRevisionCommitParams,
    CreateEnvironmentParams,
    EditEnvironmentParams,
    DeployToEnvironmentParams,
} from "./core"

// ============================================================================
// API FUNCTIONS
// ============================================================================

export {
    // Fetch
    fetchEnvironmentsList,
    fetchEnvironmentDetail,
    fetchEnvironmentRevisionsList,
    fetchLatestEnvironmentRevision,
    fetchEnvironmentsBatch,
    // Environment CRUD
    createEnvironment,
    editEnvironment,
    archiveEnvironment,
    unarchiveEnvironment,
    guardEnvironment,
    unguardEnvironment,
    // Revision mutations
    commitEnvironmentRevision,
    deployToEnvironment,
    undeployFromEnvironment,
} from "./api"

// ============================================================================
// STATE ATOMS (Advanced Usage)
// ============================================================================

export {
    environmentQueryAtomFamily,
    environmentsListQueryAtomFamily,
    environmentDraftAtomFamily,
    // Slug-based resolution
    environmentBySlugAtomFamily,
    // App-scoped deployment selectors
    environmentAppDeploymentsAtomFamily,
    environmentAppDeploymentsBySlugAtomFamily,
    appDeploymentInEnvironmentAtomFamily,
    type AppDeploymentInfo,
    // Revision deployment lookup
    revisionDeploymentAtomFamily,
    type RevisionDeployment,
    // Revisions list
    revisionsListQueryAtomFamily,
    enableRevisionsListQueryAtom,
    invalidateEnvironmentRevisionsListCache,
    // App-scoped deployment atom families (parameterized by appId)
    appEnvironmentsQueryAtomFamily,
    appEnvironmentsAtomFamily,
    appEnvironmentsLoadableAtomFamily,
    type AppEnvironmentDeployment,
} from "./state"
