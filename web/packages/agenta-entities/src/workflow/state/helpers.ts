/**
 * Workflow State Helpers
 *
 * Shared utility functions used by both `store.ts` and `runnableSetup.ts`.
 * Extracted to avoid circular dependencies between those modules.
 *
 * @packageDocumentation
 */

import {getAgentaApiUrl} from "@agenta/shared/api"

import {fetchWorkflowsBatch} from "../api/api"
import {collectEvaluatorCandidates, isOnlineCapableEvaluator, type Workflow} from "../core"

import type {WorkflowType} from "./molecule"

/**
 * Fetch each non-deleted workflow's latest revision and classify the list.
 * Agent identity is revision-derived, so classification needs latest revisions.
 */
export async function fetchAndClassifyWorkflows(
    projectId: string,
    workflows: Workflow[],
    classify: (workflows: Workflow[], latestRevisions: ReadonlyMap<string, Workflow>) => Workflow[],
): Promise<Workflow[]> {
    const nonDeleted = workflows.filter((workflow) => !workflow.deleted_at)
    const latestRevisions = await fetchWorkflowsBatch(
        projectId,
        nonDeleted.map((workflow) => workflow.id),
    )
    return classify(nonDeleted, latestRevisions)
}

export function withLatestAgentFlags(
    workflows: Workflow[],
    latestRevisions: ReadonlyMap<string, Workflow>,
): Workflow[] {
    return workflows.map((workflow) => {
        const latestRevision = latestRevisions.get(workflow.id)
        if (!latestRevision) return workflow

        return {
            ...workflow,
            flags: {
                ...workflow.flags,
                is_agent: latestRevision.flags?.is_agent ?? false,
            } as Workflow["flags"],
        }
    })
}

/**
 * Keep workflow artifacts whose latest revision is marked as an agent.
 *
 * Agent identity is revision-derived, so the artifact list cannot be filtered
 * reliably with `WorkflowQuery.flags.is_agent`.
 */
export function filterAgentWorkflows(
    workflows: Workflow[],
    latestRevisions: ReadonlyMap<string, Workflow>,
): Workflow[] {
    return withLatestAgentFlags(workflows, latestRevisions).filter(
        (workflow) => workflow.flags?.is_agent === true,
    )
}

/** Keep workflow artifacts whose latest revision is not marked as an agent. */
export function filterNonAgentWorkflows(
    workflows: Workflow[],
    latestRevisions: ReadonlyMap<string, Workflow>,
): Workflow[] {
    return withLatestAgentFlags(workflows, latestRevisions).filter(
        (workflow) => workflow.flags?.is_agent !== true,
    )
}

/**
 * Legacy evaluator keys → workflow type. Used for evaluators committed before
 * `infer_flags_from_data` populated `is_llm`/`is_match`/`is_code`/`is_hook` on
 * revisions. Keys are matched against the normalized candidate set returned by
 * `collectEvaluatorCandidates` (lowercased, `auto_` stripped, first hyphen
 * segment extracted).
 */
const LEGACY_EVALUATOR_KEY_TO_TYPE: Record<string, WorkflowType> = {
    // LLM-as-judge family
    ai_critique: "llm",
    critique: "llm",
    llm: "llm",
    // Webhook family
    webhook_test: "hook",
    webhook: "hook",
    hook: "hook",
    // Custom code family
    custom_code_run: "code",
    custom_code: "code",
    code_run: "code",
    code: "code",
    // Human feedback
    feedback: "human",
}

/**
 * Resolve an evaluator's workflow type from its revision data, falling back
 * through: flags → legacy key map → slug key map → default ("match").
 *
 * Evaluators default to "match" because the catalog skews heavily toward
 * pattern/classifier/similarity matchers, and callers that need to
 * distinguish classifier vs. similarity vs. custom-match can read tags or
 * template metadata separately.
 */
function resolveEvaluatorWorkflowType(revision: Workflow): WorkflowType {
    const flags = revision.flags
    if (flags?.is_feedback) return "human"
    if (flags?.is_llm) return "llm"
    if (flags?.is_match) return "match"
    if (flags?.is_code) return "code"
    if (flags?.is_hook) return "hook"

    const candidates = collectEvaluatorCandidates(revision.data?.uri?.split(":")[2], revision.slug)
    for (const candidate of candidates) {
        const mapped = LEGACY_EVALUATOR_KEY_TO_TYPE[candidate]
        if (mapped) return mapped
    }

    return "match"
}

/**
 * Extract service type from a URI like "agenta:builtin:completion:v0".
 *
 * @returns "completion" | "chat" | null
 */
export function resolveServiceTypeFromUri(uri: string | null | undefined): string | null {
    if (!uri || !uri.startsWith("agenta:builtin:")) return null
    const parts = uri.split(":")
    const serviceType = parts[2]
    if (!serviceType || !["completion", "chat"].includes(serviceType)) return null
    return serviceType
}

/**
 * Extract service type from a URL path like "http://host/services/completion"
 * or "http://host/services/builtin/completion/v0".
 *
 * Used as a fallback when `uri` is missing (post-migration data where
 * `data.url` is correct but `data.uri` was not preserved).
 *
 * @returns "completion" | "chat" | null
 */
export function resolveServiceTypeFromUrl(url: string | null | undefined): string | null {
    if (!url) return null
    // Match both old-style /services/completion and new-style /services/builtin/completion/v0
    const match = url.match(/\/services\/(?:builtin\/)?(completion|chat)(?:[/?]|$|\/v\d+)/)
    return match ? match[1] : null
}

/**
 * Check whether a URL points to any managed agenta service.
 *
 * Returns true for any `/services/...` URL — builtin, custom, evaluator, etc.
 * Used to suppress the OpenAPI fallback for managed service URLs.
 */
export function isManagedServiceUrl(url: string | null | undefined): boolean {
    if (!url) return false
    return /\/services\//.test(url)
}

/**
 * Build a service URL from an agenta URI.
 *
 * Converts `agenta:{kind}:{key}:{version}` → `{origin}/services/{key}/{version}`
 *
 * The `{kind}` segment (builtin, custom, etc.) is stripped — backend endpoints
 * no longer use `/builtin/` or `/custom/` prefixes.
 *
 * @returns Service URL, or null if the URI is not an agenta URI
 */
export function buildServiceUrlFromUri(uri: string | null | undefined): string | null {
    if (!uri || !uri.startsWith("agenta:")) return null
    const apiUrl = getAgentaApiUrl()
    if (!apiUrl) return null
    const origin = apiUrl.replace(/\/api\/?$/, "")
    // agenta:{kind}:{key}:{version} → strip kind, keep {key}/{version}
    const parts = uri.replace(/^agenta:/, "").split(":")
    // parts = [kind, key, version] — drop kind
    if (parts.length < 3) return null
    const [, ...rest] = parts
    return `${origin}/services/${rest.join("/")}`
}

/**
 * Resolve the correct service URL for a builtin (non-custom) app workflow.
 *
 * For builtin apps with URI like "agenta:builtin:completion:v0", the service
 * is hosted at a deterministic path: `{origin}/services/{serviceType}`.
 * The URI is preferred because `data.url` may point to a stale/migrated domain.
 *
 * When the URI is missing (post-migration data corruption), falls back to
 * `data.url` if it matches the builtin `/services/{type}` pattern — these
 * revisions were created after the migration so their URL is already correct.
 *
 * @returns Corrected service URL, or null if not a builtin app
 */
export function resolveBuiltinAppServiceUrl(entity: Workflow): string | null {
    if (!entity.data) return null
    if (entity.flags?.is_evaluator) return null
    if (entity.flags?.is_custom) return null

    const uri = entity.data.uri
    const url = entity.data.url

    // Case 1: URI exists — extract type from URI, build canonical URL
    const serviceTypeFromUri = resolveServiceTypeFromUri(uri)
    if (serviceTypeFromUri) {
        const apiUrl = getAgentaApiUrl()
        if (!apiUrl) return null
        const origin = apiUrl.replace(/\/api\/?$/, "")
        return `${origin}/services/${serviceTypeFromUri}`
    }

    // Case 2: URI missing but URL contains /services/{type} — use URL as-is
    // (post-migration data where data.url is already correct)
    const serviceTypeFromUrl = resolveServiceTypeFromUrl(url)
    if (serviceTypeFromUrl) {
        return url!
    }

    return null
}

// ============================================================================
// APP TYPE DERIVATION FROM LATEST REVISION
// ============================================================================

/**
 * Derive the app type from a workflow revision.
 *
 * For evaluators, the evaluator-kind flags (`is_llm`/`is_match`/`is_code`/
 * `is_hook`/`is_feedback`) are the source of truth — the URI often points at
 * the underlying invocation target (e.g. an LLM-as-judge evaluator invokes
 * `agenta:builtin:completion:v0`), so trusting the URI first would
 * misclassify every evaluator as `completion`.
 *
 * For apps, the URI remains the source of truth (reliable — backend always
 * stores it correctly), with flags as a fallback for cases like `is_chat`
 * which isn't inferred from the URI at commit time.
 */
export function deriveWorkflowTypeFromRevision(
    revision: Workflow | null | undefined,
    /**
     * Optional override. Pass the artifact's `is_evaluator` flag when
     * available — revisions returned by `fetchWorkflowsBatch` do not always
     * propagate the role flag, so relying on `revision.flags.is_evaluator`
     * alone misclassifies every legacy evaluator as "completion".
     */
    options?: {isEvaluator?: boolean},
): WorkflowType {
    if (!revision) return "completion"

    const flags = revision.flags
    const uri = revision.data?.uri
    const uriKey = uri ? uri.split(":")[2] : null

    // Detect evaluators from any available signal:
    //  1. Caller-provided override (usually the artifact flag).
    //  2. `is_evaluator` on the revision itself.
    //  3. Any evaluator-kind flag (`is_feedback`/`is_llm`/`is_match`/`is_code`/`is_hook`).
    //  4. A known legacy evaluator key in the URI or slug — catches the
    //     common case of revisions with no flags and a template-derived URI
    //     like `agenta:builtin:auto_ai_critique:v0`.
    const uriCandidates = collectEvaluatorCandidates(uriKey, revision.slug)
    const hasEvaluatorKindFlag = !!(
        flags?.is_feedback ||
        flags?.is_llm ||
        flags?.is_match ||
        flags?.is_code ||
        flags?.is_hook
    )
    const hasLegacyEvaluatorKey = uriCandidates.some(
        (candidate) => candidate in LEGACY_EVALUATOR_KEY_TO_TYPE,
    )
    const isEvaluator =
        options?.isEvaluator === true ||
        flags?.is_evaluator === true ||
        hasEvaluatorKindFlag ||
        hasLegacyEvaluatorKey

    // Evaluators: evaluator URIs describe the invocation target (e.g.
    // `agenta:builtin:auto_exact_match:v0` → key `auto_exact_match`), not a
    // `chat`/`completion`/etc. workflow type. Route through the evaluator
    // resolver instead of the generic URI branch below.
    if (isEvaluator) {
        return resolveEvaluatorWorkflowType(revision)
    }

    // Apps: URI is the source of truth. Format: provider:kind:key:version.
    if (uriKey === "agent") return "agent"
    if (uriKey === "chat") return "chat"
    if (uriKey === "completion") return "completion"
    if (uriKey === "llm") return "llm"
    if (uriKey === "code") return "code"
    if (uriKey === "hook") return "hook"
    if (uriKey === "match") return "match"
    if (uriKey === "feedback") return "human"

    // Fallback to flags for apps without a matching URI kind. Agent wins over
    // is_custom/is_chat (an agent currently surfaces as custom + is_chat).
    if (flags?.is_agent) return "agent"
    if (flags?.is_custom) return "custom"
    if (flags?.is_chat) return "chat"

    // Custom workflows have a URL but no managed URI
    if (flags?.has_url && !flags?.is_managed) return "custom"

    return "completion"
}

/**
 * Keep evaluator artifacts whose latest revision resolves to the LLM family.
 *
 * The artifact list does not carry evaluator-family flags, so classification
 * must use the latest revision. `deriveWorkflowTypeFromRevision` also preserves
 * support for legacy LLM evaluator keys created before `is_llm` was populated.
 */
export function filterLlmEvaluatorWorkflows(
    workflows: Workflow[],
    latestRevisions: ReadonlyMap<string, Workflow>,
): Workflow[] {
    return workflows.filter((workflow) => {
        const revision = latestRevisions.get(workflow.id)
        return deriveWorkflowTypeFromRevision(revision, {isEvaluator: true}) === "llm"
    })
}

/** Keep automatic evaluators whose latest revision supports live evaluation. */
export function filterNonDeterministicEvaluatorWorkflows(
    workflows: Workflow[],
    latestRevisions: ReadonlyMap<string, Workflow>,
): Workflow[] {
    return workflows.filter((workflow) => {
        const revision = latestRevisions.get(workflow.id)
        if (!revision || revision.flags?.is_feedback) return false

        return isOnlineCapableEvaluator({
            flags: revision.flags as Record<string, unknown> | null,
            data: revision.data as {uri?: string | null} | null,
            meta: revision.meta as Record<string, unknown> | null,
            slug: revision.slug ?? workflow.slug ?? null,
        })
    })
}
