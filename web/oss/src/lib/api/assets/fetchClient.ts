import {getDefaultStore} from "jotai"

import {projectIdAtom} from "../../../state/project"
import {getAgentaApiUrl} from "../../helpers/api"

// Lazily import to avoid circulars in non-test
async function safeGetJWT(): Promise<string | undefined> {
    try {
        const {getJWT} = await import("@/oss/services/api")
        const token = await getJWT()
        return token || undefined
    } catch {
        return undefined
    }
}

export function isTestEnv(): boolean {
    return typeof process !== "undefined" && process.env.NODE_ENV === "test"
}

export function getBaseUrl(): string {
    // In tests, allow overriding via env to ensure absolute URLs
    if (isTestEnv()) {
        const fromEnv = process.env.VITEST_TEST_API_URL
        if (fromEnv && fromEnv.trim().length > 0) return fromEnv
    }
    const base = getAgentaApiUrl()
    return base && base.trim().length > 0 ? base : "http://localhost"
}

export function ensureProjectId(existing?: string): string | undefined {
    if (existing) return existing
    if (process.env.VITEST_TEST_PROJECT_ID) return process.env.VITEST_TEST_PROJECT_ID
    try {
        const store = getDefaultStore()
        const pid = store.get(projectIdAtom)
        return pid
    } catch {
        return undefined
    }
}

export function ensureAppId(existing?: string): string {
    if (isTestEnv() && process.env.VITEST_TEST_APP_ID) return process.env.VITEST_TEST_APP_ID
    return existing || ""
}

export async function getAuthToken(): Promise<string | undefined> {
    // Prefer explicit test JWT if provided via env, regardless of NODE_ENV
    if (process.env.NODE_ENV === "test" && process.env.VITEST_TEST_JWT)
        return process.env.VITEST_TEST_JWT
    return safeGetJWT()
}

export async function fetchJson(url: URL, init: RequestInit = {}): Promise<any> {
    const jwt = await getAuthToken()

    const headers = new Headers(init.headers || {})
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json")
    if (jwt && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${jwt}`)

    if (process.env.DEBUG_FETCH === "true") {
        const redacted = new Headers(headers)
        if (redacted.has("Authorization")) redacted.set("Authorization", "Bearer ***")
    }

    const res = await fetch(url.toString(), {...init, headers})
    const contentType = res.headers.get("content-type") || ""

    if (!res.ok) {
        let parsedBody: any = undefined
        try {
            parsedBody = contentType.includes("application/json")
                ? await res.clone().json()
                : await res.clone().text()
        } catch {
            parsedBody = undefined
        }

        const detail =
            (parsedBody as any)?.detail ||
            (parsedBody as any)?.error ||
            (typeof parsedBody === "string" ? parsedBody : undefined)

        const errorMessage =
            detail && typeof detail === "string"
                ? `${detail}`
                : `${init.method || "GET"} ${url.pathname} failed: ${res.status}`

        const error = new Error(errorMessage)
        ;(error as any).status = res.status
        ;(error as any).statusText = res.statusText
        ;(error as any).data = parsedBody
        throw error
    }

    if (contentType.includes("application/json")) return res.json()
    return res.text()
}
