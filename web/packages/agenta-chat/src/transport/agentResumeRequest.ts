/**
 * Lite agent resume request — the invoke body for answering a HITL approval without the
 * hydrated workflow molecule (mobile, or any client that can't run the full
 * `buildAgentRequest` pipeline).
 *
 * Load-bearing invariant: the body carries NO `parameters` key unless we are deliberately
 * replaying the gated turn's stamped effective config (the interaction row's
 * `data.parameters`, written by the runner from the SDK's `effectiveParameters`). The SDK
 * resolver hydrates config server-side ONLY when the request has `references` and no
 * `data.parameters` (`sdks/python/agenta/sdk/middlewares/running/resolver.py`
 * `needs_reference_hydration`), so:
 *   - non-empty stamped parameters  -> emit them; hydration is skipped and the resume runs
 *     under the exact config the gated turn ran under (including its tool permissions);
 *   - absent / empty parameters     -> emit NO key at all; an empty `{}` would suppress
 *     hydration and run an unconfigured agent, which is worse than the wrong revision.
 * The unit tests pin both directions.
 */

/** A `{id, slug, version}` platform reference (values may be partial). */
export interface AgentResumeReference {
    id?: string | null
    slug?: string | null
    version?: string | null
}

export interface AgentResumeRequestArgs {
    /** The service invoke endpoint (`{serviceUrl}/invoke`) — see `resolveInvocationUrl`. */
    invocationUrl: string
    /** Role-keyed workflow refs (`workflow`/`workflow_variant`/`workflow_revision`, or the
     * `application_*` family) — sent verbatim for server-side reference hydration. */
    references: Record<string, AgentResumeReference> | null
    sessionId: string
    /** The full v6 UIMessage history with the approval decision stamped on the tail. */
    messages: unknown[]
    /** The gated turn's stamped effective config (interaction row `data.parameters`). Sent
     * inline to replay that exact config; omit/empty falls back to reference hydration. */
    parameters?: Record<string, unknown> | null
    /** ALWAYS rides the query string — the invoke routing middleware reads it for cookie-auth
     * permission checks (auth.py). Do not copy desktop's Authorization-gated omission. */
    projectId?: string
    applicationId?: string
}

export interface AgentResumeRequest {
    invocationUrl: string
    headers: Record<string, string>
    requestBody: {
        session_id: string
        references: Record<string, AgentResumeReference> | null
        data: {inputs: {messages: unknown[]}; parameters?: Record<string, unknown>}
    }
}

/** A stamped config is replayable only if it is a plain object with at least one key. */
const hasStampedConfig = (
    parameters: Record<string, unknown> | null | undefined,
): parameters is Record<string, unknown> =>
    !!parameters &&
    typeof parameters === "object" &&
    !Array.isArray(parameters) &&
    Object.keys(parameters).length > 0

const withQuery = (url: string, params: Record<string, string | undefined>): string => {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (value) qs.set(key, value)
    }
    const suffix = qs.toString()
    return suffix ? `${url}${url.includes("?") ? "&" : "?"}${suffix}` : url
}

/** Compose the resume invoke request (see module docstring). */
export const buildAgentResumeRequest = ({
    invocationUrl,
    references,
    sessionId,
    messages,
    parameters,
    projectId,
    applicationId,
}: AgentResumeRequestArgs): AgentResumeRequest => ({
    invocationUrl: withQuery(invocationUrl, {
        application_id: applicationId,
        project_id: projectId,
    }),
    headers: {
        // The stream Accept keeps `/invoke` on the v6 SSE channel; a fire-and-forget caller
        // simply drains the response. The vercel format header selects the UIMessage ingest.
        Accept: "text/event-stream",
        "x-ag-messages-format": "vercel",
    },
    requestBody: {
        session_id: sessionId,
        references,
        // Spread, never assign: an explicit `parameters: undefined` still creates the key,
        // and `JSON.stringify` dropping it is not enough for a structural caller.
        data: {inputs: {messages}, ...(hasStampedConfig(parameters) ? {parameters} : {})},
    },
})
