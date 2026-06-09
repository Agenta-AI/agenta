/**
 * Types for the generic evaluation session engine.
 *
 * The engine is scenario-source-agnostic: it operates over an INJECTED list of scenarios
 * (annotation injects a queue-scoped, user-filtered source; the eval-run view injects a
 * run-scoped source). The engine owns navigation / progress / focus / view only.
 */
import type {EvaluationScenario} from "@agenta/entities/evaluationScenario"

export type SessionView = "list" | "annotate" | "configuration"

/** Scenario row the engine navigates over (id + status are all it needs). */
export type SessionScenario = EvaluationScenario

/** The run a session is bound to. Supplied by the consumer (decoupled from any store). */
export interface SessionContext {
    projectId: string
    runId: string | null
}

/** Injected scenario source query state (loading indicators). */
export interface SessionScenariosQueryState {
    isPending: boolean
    isError: boolean
    data: unknown
}

export interface OpenSessionPayload {
    projectId: string
    runId: string | null
    /** Optional initial view from route state. */
    initialView?: SessionView
    /** Optional initial focused scenario from route state. */
    initialScenarioId?: string | null
}

export interface ApplyRouteStatePayload {
    view?: SessionView
    scenarioId?: string | null
}

export interface SessionProgress {
    /** Total number of scenarios */
    total: number
    /** Number of completed scenarios */
    completed: number
    /** Remaining items */
    remaining: number
    /** Current position (0-indexed) */
    currentIndex: number
}

/** Consumer hooks fired by the engine (e.g. route sync, submit side-effects). */
export interface SessionCallbacks {
    onOpened?: (ctx: SessionContext) => void
    onNavigate?: (scenarioId: string, index: number) => void
    onSubmitted?: (scenarioId: string) => void
    onClosed?: () => void
}
