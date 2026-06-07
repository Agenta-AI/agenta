/**
 * Resource client for the `/evaluations/queues/*` endpoints, taken from the
 * Fern-generated `@agentaai/api-client` via the workspace SDK singleton.
 *
 * `@agenta/sdk` is imported LAZILY (dynamic `import()`) — see the rationale in
 * `evaluationRun/api/client.ts`: a static import of the ESM-only `@agentaai/api-client`
 * breaks CJS-first test resolvers (`tsx --test`) the moment a molecule using these
 * fetchers is imported. Deferring to call-time keeps those suites green.
 */
export async function getEvaluationsClient() {
    const {getAgentaSdkClient} = await import("@agenta/sdk")
    return getAgentaSdkClient().evaluations
}

/**
 * Per-request options that scope a Fern call to a specific project; mirrors the
 * legacy axios `project_id` query-param injection.
 */
export function projectScopedRequest(projectId: string) {
    return {queryParams: {project_id: projectId}}
}
