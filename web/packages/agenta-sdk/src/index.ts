/**
 * Agenta TypeScript SDK — thin convenience wrapper over `@agentaai/api-client`.
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
} from "@agentaai/api-client"

import {type AgentaInitOptions, buildClientOptions} from "./config"

export {AgentaApiClient, AgentaApiEnvironment, AgentaApiError, AgentaApiTimeoutError}
export type * as AgentaApi from "@agentaai/api-client"

export type {AgentaInitOptions} from "./config"
export {configureAgentaSdk, buildClientOptions} from "./config"
// Per-resource accessors — prefer these over `getAgentaSdkClient()`; they let
// webpack ship only the resource clients a page actually uses (see ./resources).
export * from "./resources"

/**
 * Construct an Agenta SDK client. Mirrors Python's `ag.init(host, api_key, project_id)`.
 *
 * Resource clients are reachable as properties on the returned object:
 *   const ag = init({apiKey: "..."});
 *   const apps = await ag.applications.queryApplications({});
 *
 * NOTE: this returns the monolithic client, which statically bundles all Fern
 * resource clients (~515 kB). Prefer the per-resource accessors from
 * `@agenta/sdk/resources` (e.g. `getTracesClient()`) so only the resources a
 * page uses are bundled. `init`/`getAgentaSdkClient` remain for compatibility
 * and for code that genuinely needs many resources from one instance.
 */
export function init(options: AgentaInitOptions = {}): AgentaApiClient {
    return new AgentaApiClient(buildClientOptions(options))
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
