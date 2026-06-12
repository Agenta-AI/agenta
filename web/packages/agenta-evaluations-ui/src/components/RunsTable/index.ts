/**
 * Eval run-list view (relocated from `@/oss/components/EvaluationRunsTablePOC`, WP-4h-4).
 *
 * The view root, the latest-runs summary table, the scoped-store provider, and the table
 * store atoms. Depends on OSS-owned components/hooks via the eval-view host registry
 * (`EvalViewHostProvider`) and on OSS app-state via the `@agenta/evaluations` injection
 * seams — both wired by the OSS route shell.
 */
export {default as EvaluationRunsTable} from "./components/EvaluationRunsTable"
// Back-compat alias for OSS consumers that imported the old POC name.
export {default as EvaluationRunsTablePOC} from "./components/EvaluationRunsTable"
export {default as LatestEvaluationRunsTable} from "./components/LatestEvaluationRunsTable"
export {default as EvaluationRunsTableStoreProvider} from "./providers/EvaluationRunsTableStoreProvider"
export {default as EvaluationRunsCreateButton} from "./components/EvaluationRunsCreateButton"

export * from "./atoms/tableStore"
export {
    evaluationRunsTableContextSetterAtom,
    evaluationRunsTableOverridesAtom,
    type EvaluationRunsTableOverrides,
} from "./atoms/context"
export {evaluationRunsTypeFiltersAtom} from "./atoms/view"
