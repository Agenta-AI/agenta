/**
 * Shared client configuration for the Agenta SDK.
 *
 * This module deliberately does NOT import the monolithic `AgentaApiClient`
 * (which statically pulls all 27 Fern resource clients, ~515 kB). Consumers
 * that only need one resource import it via `./resources`, and the host pin
 * lives here so `_app` can configure the host without constructing the full
 * client. Keeping this import surface free of `AgentaApiClient` is what lets
 * webpack tree-shake the bundle down to the resources a page actually uses.
 */
import type {AgentaApiClient} from "@agentaai/api-client"

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

let pinned: AgentaInitOptions = {}

/**
 * Pin the host (and optionally api key) for every SDK client in this runtime.
 *
 * Replaces the old pattern of calling `getAgentaSdkClient({host})` purely to
 * fix the singleton's host — that pulled the entire `AgentaApiClient` into the
 * `_app` bundle. Call this once at app startup, before any resource client is
 * constructed.
 */
export function configureAgentaSdk(options: AgentaInitOptions): void {
    pinned = {...pinned, ...options}
}

/**
 * Build the normalized options every Fern client constructor accepts
 * (`BaseClientOptions`). Resource clients self-normalize auth in their own
 * constructors, so these options are auth-identical whether passed to the root
 * client or an individual resource client.
 */
export function buildClientOptions(options: AgentaInitOptions = {}): AgentaApiClient.Options {
    const host = options.host ?? pinned.host ?? env("AGENTA_HOST") ?? "https://cloud.agenta.ai"
    const apiKey = options.apiKey ?? pinned.apiKey ?? env("AGENTA_API_KEY")

    return {
        environment: host,
        apiKey: apiKey ?? "",
        // Drop the empty `Authorization` header Fern's HeaderAuthProvider sets
        // when apiKey is "" (browser cookie-auth case). Empty strings aren't
        // `== null`, so the auth provider runs and emits an empty Authorization
        // that Agenta's CORS allowlist rejects. The fetch wrapper is the last
        // point we control before the wire — `mergeHeaders` calls upstream
        // re-add what we strip via the `headers` option.
        fetch: !apiKey
            ? (input, requestInit) => {
                  const sanitized = new Headers(requestInit?.headers)
                  if ((sanitized.get("authorization") ?? "") === "") {
                      sanitized.delete("authorization")
                  }
                  return fetch(input, {...requestInit, headers: sanitized})
              }
            : undefined,
    }
}

/**
 * Wrap a client's fetch so its requests carry the `priority: "low"` hint —
 * Chromium schedules them behind render-critical traffic; other engines
 * ignore the hint. Composes with the auth-sanitizing fetch when present.
 * Use for background hydration (e.g. per-turn trace summaries), never for
 * user-initiated loads.
 */
export function withLowPriorityFetch(options: AgentaApiClient.Options): AgentaApiClient.Options {
    const baseFetch = options.fetch ?? fetch
    return {
        ...options,
        fetch: (input, requestInit) => baseFetch(input, {...requestInit, priority: "low"}),
    }
}
