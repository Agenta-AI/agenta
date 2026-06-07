/**
 * Resource client for the `/evaluations/*` run/result/metric endpoints, taken from
 * the Fern-generated `@agentaai/api-client` via the workspace SDK singleton.
 *
 * `@agenta/sdk` is imported LAZILY (dynamic `import()`), not statically. Reason:
 * `@agentaai/api-client` is ESM-only (its `exports` define only an `import`
 * condition, no `require`). A static top-level import would make merely *importing*
 * this module — which happens transitively whenever a molecule that uses these
 * fetchers is imported, e.g. in the `tsx --test` molecule cache-contract suite —
 * eagerly link the ESM-only client through a CJS-first resolver, which throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`. Deferring to a dynamic `import()` (a) uses the
 * ESM loader so resolution is correct at call time, and (b) is never triggered by
 * tests that exercise the cache directly without hitting the network.
 */
export async function getEvaluationsClient() {
    const {getAgentaSdkClient} = await import("@agenta/sdk")
    return getAgentaSdkClient().evaluations
}

/**
 * Per-request options that scope a Fern call to a specific project. Fern's generated
 * evaluations requests don't model `project_id`; the legacy axios layer injected it
 * as a query param and we mirror that via `queryParams`.
 */
export function projectScopedRequest(projectId: string) {
    return {queryParams: {project_id: projectId}}
}
