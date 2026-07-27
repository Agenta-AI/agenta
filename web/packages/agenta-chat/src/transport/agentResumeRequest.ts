/**
 * Lite agent resume request — the references-only invoke body for answering a HITL approval
 * without the hydrated workflow molecule (mobile, or any client that can't run the full
 * `buildAgentRequest` pipeline).
 *
 * Load-bearing invariant: the body carries NO `data.parameters`. The SDK resolver hydrates the
 * config server-side ONLY when the request has `references` and no `data.parameters`
 * (`sdks/python/agenta/sdk/middlewares/running/resolver.py` `needs_reference_hydration`), so
 * emitting a `parameters` key — even empty — would skip hydration and run an unconfigured
 * draft. The unit test pins this.
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
        data: {inputs: {messages: unknown[]}}
    }
}

const withQuery = (url: string, params: Record<string, string | undefined>): string => {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (value) qs.set(key, value)
    }
    const suffix = qs.toString()
    return suffix ? `${url}${url.includes("?") ? "&" : "?"}${suffix}` : url
}

/** Compose the references-only resume invoke request (see module docstring). */
export const buildAgentResumeRequest = ({
    invocationUrl,
    references,
    sessionId,
    messages,
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
        data: {inputs: {messages}},
    },
})
