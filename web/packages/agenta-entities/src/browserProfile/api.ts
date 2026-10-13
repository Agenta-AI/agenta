import {getBrowserProfilesClient} from "@agenta/sdk/resources"
import type {z} from "zod"

import {safeParseWithLogging} from "../shared"

import {
    browserLiveStatusSchema,
    browserProfileResponseSchema,
    browserProfilesResponseSchema,
    type BrowserProfile,
    type BrowserProfileInput,
} from "./types"

/** The API's `detail` (a string, or an agent error's `message`) instead of Fern's status text. */
const detailOf = (error: unknown): string | undefined => {
    const detail = (error as {body?: {detail?: unknown}} | null)?.body?.detail
    if (typeof detail === "string") return detail
    if (detail && typeof detail === "object" && "message" in detail) {
        return String((detail as {message: unknown}).message)
    }
    return undefined
}

const call = async <T>(run: () => Promise<unknown>, schema: z.ZodType<T>, label: string) => {
    let data: unknown
    try {
        data = await run()
    } catch (error) {
        throw new Error(detailOf(error) ?? "The browser login request failed.")
    }
    const parsed = safeParseWithLogging(schema, data, `[browserProfile.${label}]`)
    if (!parsed) throw new Error("The server sent a browser profile in an unexpected shape.")
    return parsed
}

const scope = (projectId: string, timeoutInSeconds?: number) => ({
    queryParams: {project_id: projectId},
    timeoutInSeconds,
})

// Starting a login may create and boot a browser sandbox first.
const LOGIN_START_TIMEOUT_SECONDS = 120

const profileCall = async (run: () => Promise<unknown>, label: string): Promise<BrowserProfile> =>
    (await call(run, browserProfileResponseSchema, label)).profile

export const queryBrowserProfiles = async (projectId: string): Promise<BrowserProfile[]> =>
    (
        await call(
            () => getBrowserProfilesClient().queryBrowserProfiles(scope(projectId)),
            browserProfilesResponseSchema,
            "query",
        )
    ).profiles

export const createBrowserProfile = (projectId: string, profile: BrowserProfileInput) =>
    profileCall(
        () => getBrowserProfilesClient().createBrowserProfile({profile}, scope(projectId)),
        "create",
    )

export const updateBrowserProfile = (
    projectId: string,
    {profileId, ...profile}: Partial<BrowserProfileInput> & {profileId: string},
) =>
    profileCall(
        () =>
            getBrowserProfilesClient().editBrowserProfile(
                {profile_id: profileId, profile},
                scope(projectId),
            ),
        "update",
    )

export const archiveBrowserProfile = (projectId: string, profileId: string) =>
    profileCall(
        () =>
            getBrowserProfilesClient().archiveBrowserProfile(
                {profile_id: profileId},
                scope(projectId),
            ),
        "archive",
    )

export const startBrowserLogin = (projectId: string, profileId: string) =>
    profileCall(
        () =>
            getBrowserProfilesClient().startBrowserProfileLogin(
                {profile_id: profileId},
                scope(projectId, LOGIN_START_TIMEOUT_SECONDS),
            ),
        "loginStart",
    )

export const finishBrowserLogin = (projectId: string, profileId: string) =>
    profileCall(
        () =>
            getBrowserProfilesClient().finishBrowserProfileLogin(
                {profile_id: profileId},
                scope(projectId),
            ),
        "loginFinish",
    )

export const cancelBrowserLogin = async (projectId: string, profileId: string): Promise<void> => {
    try {
        await getBrowserProfilesClient().cancelBrowserProfileLogin(
            {profile_id: profileId},
            scope(projectId),
        )
    } catch (error) {
        throw new Error(detailOf(error) ?? "Could not cancel the sign-in.")
    }
}

export const fetchBrowserLiveStatus = (projectId: string, sessionId: string) =>
    call(
        () =>
            getBrowserProfilesClient().fetchBrowserLiveStatus(
                {session_id: sessionId},
                scope(projectId),
            ),
        browserLiveStatusSchema,
        "liveStatus",
    )
