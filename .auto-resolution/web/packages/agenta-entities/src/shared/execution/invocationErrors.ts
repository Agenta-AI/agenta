/**
 * Shared helpers for reporting invocation failures.
 *
 * The playground and runnable execution paths all POST to a revision's
 * invocation URL. Two failure modes used to leak through as confusing run
 * output:
 *   1. The revision has no invocation URL (empty `uri` and `url`), so the
 *      request resolved to the web app origin and returned the app's 404 page.
 *   2. The service is unreachable or misconfigured, so the response body is an
 *      HTML error page instead of JSON.
 *
 * In both cases an LLM-judge evaluator received a blob of HTML as the "output"
 * instead of a clear error. These helpers produce a readable message instead.
 *
 * They are intentionally dependency-free pure functions so the playground web
 * worker can import this file without pulling in the rest of the package.
 *
 * @packageDocumentation
 */

/** Message shown when a revision has no invocation URL to call. */
export const MISSING_INVOCATION_URL_ERROR =
    "No invocation URL configured for this revision (empty uri and url)"

/**
 * True when a response body looks like an HTML document rather than JSON.
 * Matches a leading `<!doctype ...>` or `<html ...>` tag (case-insensitive).
 */
export function isHtmlBody(body: string | null | undefined): boolean {
    return typeof body === "string" && /^\s*<(!doctype|html)[\s>]/i.test(body)
}

/** Message shown when the service returns an HTML page instead of JSON. */
export function describeUnreachableService(url: string | null | undefined, status: number): string {
    return `Service unreachable${url ? ` at ${url}` : ""} (HTTP ${status})`
}
