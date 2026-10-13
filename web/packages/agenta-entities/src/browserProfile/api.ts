import {getAgentaApiUrl} from "@agenta/shared/api"
import type {z} from "zod"

import {safeParseWithLogging} from "../shared"

import {
    browserLiveStatusSchema,
    browserProfileResponseSchema,
    browserProfilesResponseSchema,
    type BrowserProfile,
    type BrowserProfileInput,
} from "./types"

const errorMessage = async (res: Response): Promise<string> => {
    const body = (await res.json().catch(() => null)) as {detail?: unknown} | null
    const detail = body?.detail
    if (typeof detail === "string") return detail
    if (detail && typeof detail === "object" && "message" in detail) {
        return String((detail as {message: unknown}).message)
    }
    return `Request failed (HTTP ${res.status})`
}

// Not in the Fern client yet; move to it on the next regen.
const request = async (
    projectId: string,
    path: string,
    method: "POST" | "PUT" = "POST",
    body: unknown = {},
): Promise<Response> => {
    const url = new URL(`${getAgentaApiUrl()}/browser-profiles${path}`)
    url.searchParams.set("project_id", projectId)
    const res = await fetch(url.toString(), {
        method,
        credentials: "include",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await errorMessage(res))
    return res
}

const parse = async <T>(res: Response, schema: z.ZodType<T>, label: string): Promise<T> => {
    const data = safeParseWithLogging(schema, await res.json(), `[browserProfile.${label}]`)
    if (!data) throw new Error("The server sent a browser profile in an unexpected shape.")
    return data
}

const profileRoute = (profileId: string, suffix = "") =>
    `/${encodeURIComponent(profileId)}${suffix}`

const profileCall = async (
    projectId: string,
    path: string,
    label: string,
    method?: "POST" | "PUT",
    body?: unknown,
): Promise<BrowserProfile> =>
    (await parse(await request(projectId, path, method, body), browserProfileResponseSchema, label))
        .profile

export const queryBrowserProfiles = async (projectId: string): Promise<BrowserProfile[]> => {
    const res = await request(projectId, "/query")
    return (await parse(res, browserProfilesResponseSchema, "query")).profiles
}

export const createBrowserProfile = (projectId: string, profile: BrowserProfileInput) =>
    profileCall(projectId, "/", "create", "POST", {profile})

export const updateBrowserProfile = (
    projectId: string,
    {profileId, ...profile}: Partial<BrowserProfileInput> & {profileId: string},
) => profileCall(projectId, profileRoute(profileId), "update", "PUT", {profile})

export const archiveBrowserProfile = (projectId: string, profileId: string) =>
    profileCall(projectId, profileRoute(profileId, "/archive"), "archive")

export const startBrowserLogin = (projectId: string, profileId: string) =>
    profileCall(projectId, profileRoute(profileId, "/login/start"), "loginStart")

export const finishBrowserLogin = (projectId: string, profileId: string) =>
    profileCall(projectId, profileRoute(profileId, "/login/finish"), "loginFinish")

export const cancelBrowserLogin = async (projectId: string, profileId: string): Promise<void> => {
    await request(projectId, profileRoute(profileId, "/login/cancel"))
}

export const fetchBrowserLiveStatus = async (projectId: string, sessionId: string) =>
    parse(
        await request(projectId, "/live/status", "POST", {session_id: sessionId}),
        browserLiveStatusSchema,
        "liveStatus",
    )
