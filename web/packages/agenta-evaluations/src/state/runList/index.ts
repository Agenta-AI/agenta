/**
 * @agenta/evaluations/state/runList
 *
 * Generic paginated run-list store for evaluation runs. Source-agnostic, keyed
 * by `{projectId}` + filter atoms (status / kind / search). Renders every
 * matching run — no queue-specific display filter.
 */
export {
    evaluationRunPaginatedStore,
    evaluationRunStatusFilterAtom,
    evaluationRunKindFilterAtom,
    evaluationRunSearchTermAtom,
    type EvaluationRunTableRow,
} from "./paginatedStore"
