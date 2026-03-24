/**
 * Environment State - Molecules and store atoms
 */

export {
    environmentMolecule,
    invalidateEnvironmentsListCache,
    invalidateEnvironmentCache,
    type EnvironmentMolecule,
    type RevertDeploymentParams,
    type RevertToSnapshotParams,
} from "./environmentMolecule"

export {
    // Query atoms
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
    // Cache invalidation
    invalidateEnvironmentRevisionsListCache,
} from "./store"

export {
    // App-scoped deployment atom families (parameterized by appId)
    appEnvironmentsQueryAtomFamily,
    appEnvironmentsAtomFamily,
    appEnvironmentsLoadableAtomFamily,
    type AppEnvironmentDeployment,
} from "./appDeployments"
