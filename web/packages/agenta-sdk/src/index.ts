/**
 * Agenta TypeScript SDK — thin convenience wrapper over `@agenta/client`.
 *
 * Mirrors the Python SDK's pattern: the generated Fern client owns transport,
 * retries, errors, and resource shapes. This package re-exports it with a
 * convenience init function and surfaces resource clients as a flat namespace
 * (`ag.applications.*`, `ag.workflows.*`, etc.).
 *
 * v3 PoC scope: prove the Fern client integrates cleanly with the workspace
 * and types resolve end-to-end. Tracing, helpers, and the rest of the
 * convenience surface land in subsequent sprints per the v3 plan.
 */

import {
    AgentaApiClient,
    AgentaApiEnvironment,
    AgentaApiError,
    AgentaApiTimeoutError,
} from "@agenta/client"

export {AgentaApiClient, AgentaApiEnvironment, AgentaApiError, AgentaApiTimeoutError}
export type * as AgentaApi from "@agenta/client"

export interface AgentaInitOptions {
    /** Agenta backend host. Defaults to `AGENTA_HOST` env var or production. */
    host?: string
    /** API key. Defaults to `AGENTA_API_KEY` env var. */
    apiKey?: string
    /** Project ID scope. Defaults to `AGENTA_PROJECT_ID` env var. */
    projectId?: string
}

const env = (key: string): string | undefined =>
    typeof process !== "undefined" ? process.env?.[key] : undefined

/**
 * Construct an Agenta SDK client. Mirrors Python's `ag.init(host, api_key, project_id)`.
 *
 * Resource clients are reachable as properties on the returned object:
 *   const ag = init({apiKey: "..."});
 *   const apps = await ag.applications.queryApplications({});
 */
export function init(options: AgentaInitOptions = {}): AgentaApiClient {
    const host = options.host ?? env("AGENTA_HOST") ?? "https://cloud.agenta.ai"
    const apiKey = options.apiKey ?? env("AGENTA_API_KEY")

    return new AgentaApiClient({
        environment: host,
        apiKey: apiKey ?? "",
        // Browser cookie auth: forward credentials so the existing cookie-session
        // flow continues to work. Server-side calls supply apiKey directly and
        // are unaffected by this fetch wrapper.
        fetch: (input, requestInit) =>
            fetch(input, {
                ...requestInit,
                credentials: "include",
            }),
    })
}

let _singleton: AgentaApiClient | undefined

/**
 * Lazy singleton accessor for the workspace's shared SDK client.
 *
 * First call constructs the client with the supplied (or default) options;
 * subsequent calls return the same instance regardless of arguments. Callers
 * that need a fresh instance should use {@link init} directly.
 */
export function getAgentaSdkClient(options: AgentaInitOptions = {}): AgentaApiClient {
    if (!_singleton) {
        _singleton = init(options)
    }
    return _singleton
}

export default {init, getAgentaSdkClient}
