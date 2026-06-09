/**
 * Shared helpers for the App Router assertion scripts. Keeps each
 * test-assertion-N.ts file focused on the assertion itself.
 *
 * The assertions run as standalone tsx scripts that hit a running
 * `pnpm dev` (or `pnpm build && pnpm start`) instance over HTTP. The
 * dev server is responsible for instrumentation; these scripts only
 * verify behavior visible from outside.
 */

import "dotenv/config"

export const HOST = process.env.AGENTA_HOST ?? "https://cloud.agenta.ai"
export const API_KEY = process.env.AGENTA_API_KEY
export const PROJECT_ID = process.env.AGENTA_PROJECT_ID
export const APP_BASE = process.env.APP_BASE_URL ?? "http://localhost:3101"

export function requireApiKey(name: string): string {
    if (!API_KEY) {
        console.error(`${name}: AGENTA_API_KEY required`)
        process.exit(1)
    }
    return API_KEY
}

/** Per-run unique tag — used for ag.user.id filter in spike-verify. */
export function newRunId(prefix: string): string {
    return `${prefix}-${Date.now()}`
}

/** Hit a JSON endpoint on the dev server, returning the parsed body or throwing. */
export async function postJson<T = unknown>(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
): Promise<T> {
    const res = await fetch(`${APP_BASE}${path}`, {
        method: "POST",
        headers: {"Content-Type": "application/json", ...headers},
        body: JSON.stringify(body),
        signal,
    })
    if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 300)}`)
    }
    return (await res.json()) as T
}

/** Hit a streaming endpoint, return the Response (caller pulls from body). */
export async function postStream(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
): Promise<Response> {
    const res = await fetch(`${APP_BASE}${path}`, {
        method: "POST",
        headers: {"Content-Type": "application/json", ...headers},
        body: JSON.stringify(body),
        signal,
    })
    if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 300)}`)
    }
    return res
}
