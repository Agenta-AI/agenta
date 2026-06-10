/**
 * Evaluation run status values.
 *
 * The backend persists the status as a free-form string (see `status` in the
 * evaluation-run schema), so this enum is the canonical set of recognised
 * values used across the front-end. It is intentionally permissive — it covers
 * both the legacy `EVALUATION_*` constants and the newer lowercase lifecycle
 * states emitted by the preview evaluations API.
 */
export enum EvaluationStatus {
    INITIALIZED = "EVALUATION_INITIALIZED",
    STARTED = "EVALUATION_STARTED",
    FINISHED = "EVALUATION_FINISHED",
    FINISHED_WITH_ERRORS = "EVALUATION_FINISHED_WITH_ERRORS",
    ERROR = "EVALUATION_FAILED",
    AGGREGATION_FAILED = "EVALUATION_AGGREGATION_FAILED",
    RUNNING = "running",
    SUCCESS = "success",
    FAILURE = "failure",
    FAILED = "failed",
    ERRORS = "errors",
    CANCELLED = "cancelled",
    PENDING = "pending",
    INCOMPLETE = "incomplete",
}
