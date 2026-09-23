/**
 * The agent invoke request, as documented in docs/docs/reference/agents/02-invoke-an-agent.mdx:
 * `POST {host}/services/agent/v0/invoke?project_id=...` with `Authorization: ApiKey ...`.
 *
 * The body references only the workflow, so the service resolves the agent's default variant
 * at its latest revision on every call, and the snippet keeps working after each commit.
 */
export const AGENT_INVOKE_DOCS_URL = "https://agenta.ai/docs/reference/agents/invoke-an-agent"

export interface AgentInvokeSnippetInput {
    /** The Agenta origin, without `/api`, e.g. `https://eu.cloud.agenta.ai`. */
    host: string
    projectId: string
    agentId: string
    apiKey: string
    /** `text/event-stream` when true, `application/json` otherwise. */
    stream: boolean
}

export const agentInvokeUrl = ({
    host,
    projectId,
}: Pick<AgentInvokeSnippetInput, "host" | "projectId">) =>
    `${host.replace(/\/+$/, "")}/services/agent/v0/invoke?project_id=${projectId}`

export const agentInvokeBody = (agentId: string) => ({
    references: {workflow: {id: agentId}},
    data: {inputs: {messages: [{role: "user", content: "Hello"}]}},
})

export const acceptHeader = (stream: boolean) => (stream ? "text/event-stream" : "application/json")

/** The origin the agent service is served from: the API URL without its `/api` suffix. */
export const agentHostFromApiUrl = (apiUrl: string | null | undefined): string => {
    const trimmed = (apiUrl ?? "").trim().replace(/\/+$/, "")
    if (trimmed) return trimmed.replace(/\/api$/, "")
    return typeof window !== "undefined" ? window.location.origin : ""
}
