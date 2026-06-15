/**
 * @agenta/entities/query — project-scoped saved trace filters.
 *
 * T1 ships the create-slice (used to repoint the live-eval drawer at a single
 * create path). Phase 2 adds the list/detail atoms, paginated store, molecule,
 * and filtering round-trip schemas for the Query Registry page.
 */

export {
    createSimpleQuery,
    editSimpleQuery,
    type EditSimpleQueryParams,
    archiveSimpleQuery,
    type ArchiveSimpleQueryParams,
    unarchiveSimpleQuery,
    type UnarchiveSimpleQueryParams,
    retrieveQueryRevision,
    type RetrieveQueryRevisionParams,
    querySimpleQueries,
    type QuerySimpleQueriesParams,
    countMatchingTraces,
    type CountMatchingTracesParams,
    queryMatchingTraces,
    type QueryMatchingTracesParams,
    queryQueryRevisions,
    queryRevisionsForQueries,
    type QueryRevisionsForQueriesParams,
    type QueryRevisionSummary,
    type QueryRevisionsByQueryParams,
} from "./api"

export {
    invalidateQueryCache,
    QUERY_LIST_KEY,
    QUERY_DETAIL_KEY,
    QUERY_HEAD_KEY,
    queryHeadQueryAtomFamily,
    queryHeadDraftAtomFamily,
    queryMolecule,
    saveQueryHeadAtom,
    type SaveQueryHeadParams,
} from "./state"

export type {
    SimpleQueryCreate,
    SimpleQueryEdit,
    QueryRevisionDataInput,
    SimpleQuery,
    QueryRevision,
    CreateSimpleQueryParams,
    CreateSimpleQueryResult,
} from "./core"
