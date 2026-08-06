/**
 * Environment Core - Schemas and Types
 *
 * Pure types and schemas with no external dependencies.
 */

// Schemas and entity types
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
} from "./schema"

// API parameter types
export type {
    EnvironmentListParams,
    EnvironmentDetailParams,
    EnvironmentRevisionListParams,
    EnvironmentRevisionDetailParams,
    EnvironmentRevisionDelta,
    EnvironmentRevisionCommitParams,
    CreateEnvironmentParams,
    EditEnvironmentParams,
    DeployToEnvironmentParams,
} from "./types"
