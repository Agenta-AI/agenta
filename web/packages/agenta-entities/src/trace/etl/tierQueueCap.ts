/**
 * inferQueueMaxFromPlan — per-plan cap on how many traces a single
 * "add all matching traces to annotation queue" run will batch.
 *
 * Annotation queues are for human review, so the cap reflects "how many
 * traces is a realistic batch on this tier" (bigger plans → bigger teams
 * → bigger batches), not "how many the system can technically handle".
 * The system limit is separately enforced by the export pipeline's
 * 20k-row safety ceiling.
 *
 * The frontend already fetches the plan slug via the billing subscription
 * query — this module is the pure mapping from that slug to the cap, so
 * it can be unit-tested without any React / store coupling.
 *
 * @packageDocumentation
 */

/** Conservative cap for hobby / free / unknown / pre-billing-load states. */
export const QUEUE_MAX_HOBBY = 1_000
/** Pro tier cap. */
export const QUEUE_MAX_PRO = 2_500
/** Business tier cap. */
export const QUEUE_MAX_BUSINESS = 10_000
/** Enterprise tier cap — matches the bulk-export ceiling. */
export const QUEUE_MAX_ENTERPRISE = 20_000

/**
 * Map a subscription plan slug to its per-run queue-batch cap.
 *
 * Plan slugs come from `/billing/subscription` and look like
 * `cloud_v0_pro`, `cloud_v0_business`, `cloud_v0_agenta_ai`,
 * `self_hosted_enterprise`, … — see `DefaultPlan` in
 * `api/ee/src/core/entitlements/types.py`.
 *
 * Unknown / undefined / OSS-without-billing slugs return the hobby cap —
 * a safe default that matches the historical behavior.
 */
export const inferQueueMaxFromPlan = (plan: string | null | undefined): number => {
    if (!plan || typeof plan !== "string") return QUEUE_MAX_HOBBY
    const slug = plan.toLowerCase()
    // Enterprise (Agenta-managed or self-hosted) gets the highest cap.
    if (slug.includes("enterprise") || slug.includes("agenta_ai")) {
        return QUEUE_MAX_ENTERPRISE
    }
    if (slug.includes("business")) return QUEUE_MAX_BUSINESS
    if (slug.includes("pro")) return QUEUE_MAX_PRO
    // Everything else (hobby, unknown, …) gets the conservative default.
    return QUEUE_MAX_HOBBY
}
