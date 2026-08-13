/**
 * Runner subscription status — `POST {agentServiceUrl}/runtime/subscription-status`.
 *
 * A direct service call like `inspectWorkflow`, not the Fern client: the agent service lives on its
 * own origin path (`/services/agent/v0`) and is not part of the main API's OpenAPI spec. Auth rides
 * the shared axios instance's interceptors, same as `/invoke` and `/inspect`.
 *
 * The response is deployment state, never credentials: the runner reports one login STATE per
 * harness and no paths, tokens, accounts, or plan names.
 *
 * Design: docs/design/runner-subscription-status/api-design.md
 */
import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {z} from "zod"

import {safeParseWithLogging} from "../../shared"

/** The three operational runner states, all served as HTTP 200. */
export const SUBSCRIPTION_RUNNER_STATES = ["connected", "unavailable", "incompatible"] as const
export type SubscriptionRunnerState = (typeof SUBSCRIPTION_RUNNER_STATES)[number]

/**
 * Per-harness login states the runner reports. Kept as a plain string on the wire (see the schema
 * below) so a runner that grows a new state does not blank the card — `resolveSubscriptionStatus`
 * owns the vocabulary and folds anything it does not know into the "update the runner" branch.
 */
export const SUBSCRIPTION_HARNESS_STATES = [
    "ready",
    "not_configured",
    "login_missing",
    "login_unusable",
    "unsupported",
] as const
export type SubscriptionHarnessState = (typeof SUBSCRIPTION_HARNESS_STATES)[number]

const subscriptionStatusResponseSchema = z.object({
    runner: z.enum(SUBSCRIPTION_RUNNER_STATES),
    checked_at: z.string().nullish(),
    harnesses: z
        .record(
            z.string(),
            z.object({
                state: z.string(),
                provider: z.string().nullish(),
                // A harness whose login file holds several plans (Pi) names the provider families
                // it holds; the single-provider harnesses use `provider` and omit this.
                providers: z.array(z.string()).nullish(),
            }),
        )
        .nullish(),
})

export type SubscriptionStatusResponse = z.infer<typeof subscriptionStatusResponseSchema>

/**
 * The agent service base URL, mirroring `buildServiceUrlFromUri("agenta:builtin:agent:v0")` — the
 * same origin the playground invokes. Duplicated here so the api layer keeps no state-layer import.
 */
function agentServiceUrl(): string | null {
    const apiUrl = getAgentaApiUrl()
    if (!apiUrl) return null
    return `${apiUrl.replace(/\/api\/?$/, "")}/services/agent/v0`
}

/**
 * Ask the agent service what the deployment's runner can use for `harness` right now.
 *
 * Returns `null` for every failure the caller should not treat as a crash — no API URL, no project,
 * or a payload that fails the boundary schema. A transport error still rejects, so the query atom
 * can tell "could not reach the service" apart from "unreadable answer".
 */
export async function fetchSubscriptionStatus({
    harness,
    projectId,
}: {
    harness: string
    projectId: string
}): Promise<SubscriptionStatusResponse | null> {
    const baseUrl = agentServiceUrl()
    if (!baseUrl || !harness || !projectId) return null

    const response = await axios.post(
        `${baseUrl}/runtime/subscription-status`,
        {harness},
        {params: {project_id: projectId}},
    )

    return safeParseWithLogging(
        subscriptionStatusResponseSchema,
        response.data,
        "[fetchSubscriptionStatus]",
    )
}
