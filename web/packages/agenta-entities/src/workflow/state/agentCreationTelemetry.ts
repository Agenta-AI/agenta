/**
 * Reporter seam for the silent exits of `createEphemeralAppFromTemplate`.
 *
 * Every `null` that factory returns reaches the user as the same generic sentence and reaches no
 * server, so a production failure cannot be told apart from any other. A host installs a reporter
 * (`web/oss` wires PostHog once its client is live); everywhere else the default no-op keeps the
 * package free of an analytics dependency and keeps self-hosted builds silent.
 *
 * The payload is an allowlist on purpose: fixed keys, fixed enums and numbers only. Error
 * messages, stacks, URLs, bodies, headers, tokens, emails and provider names never belong here —
 * an API message can carry any of them.
 *
 * @packageDocumentation
 */

import type {AgentModelSourceOutcome} from "./agentModelCandidates"
import type {AppType} from "./appUtils"

/** Which exit produced the `null`. */
export type AgentCreationFailureReason =
    | "aborted"
    | "no_project"
    | "templates_fetch_failed"
    | "no_template"
    | "user_timeout"
    | "sources_not_ready"

/** Which check saw the abort. Carried by `aborted` only. */
export type AgentCreationFailureStage =
    | "entry"
    | "templates_fetch"
    | "template_match"
    | "user_wait"
    | "candidate_load"
    | "inspect"
    | "before_seed"

// A `type` alias, not an `interface`: only an alias gets the implicit index signature that lets a
// host pass this straight to an analytics client typed `Record<string, unknown>`.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type AgentCreationFailurePayload = {
    reason: AgentCreationFailureReason
    type: AppType
    elapsed_ms: number
    stage?: AgentCreationFailureStage
    project_id?: string
    /** The three candidate sources, carried by `sources_not_ready`. */
    provider_connections?: AgentModelSourceOutcome
    harness_catalog?: AgentModelSourceOutcome
    subscription_status?: AgentModelSourceOutcome
    /** HTTP status of the first errored source; 0 when the error carries none. */
    status?: number
    candidate_count?: number
}

/** What a call site supplies; the factory fills in the rest. */
export type AgentCreationFailureDetails = Omit<
    AgentCreationFailurePayload,
    "type" | "elapsed_ms" | "project_id"
>

export type AgentCreationFailureReporter = (payload: AgentCreationFailurePayload) => void

let reporter: AgentCreationFailureReporter | null = null

export function setAgentCreationFailureReporter(next: AgentCreationFailureReporter | null): void {
    reporter = next
}

export function reportAgentCreationFailure(payload: AgentCreationFailurePayload): void {
    if (!reporter) return
    try {
        reporter(payload)
    } catch {
        // Reporting a failure must never become one.
    }
}
