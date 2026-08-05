import {catalogPersister} from "@agenta/shared/api/persist"
import {logAtom} from "@agenta/shared/state"
import type {User} from "@agenta/shared/types"
import type {QueryKey} from "@tanstack/react-query"
import type {AxiosError} from "axios"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"
import Router from "next/router"

import {fetchProfile, getJWT} from "@/oss/services/api"

import {sessionExistsAtom} from "../../session"

export const profileQueryAtom = atomWithQuery<User | null>((get) => ({
    queryKey: ["profile"],
    queryFn: async () => {
        const jwt = await getJWT()
        if (!jwt) {
            return null
        }

        try {
            const res = await fetchProfile()
            return (res?.data as User) ?? null
        } catch (error) {
            if ((error as AxiosError)?.response?.status === 401) {
                return null
            }
            throw error
        }
    },
    throwOnError(error, query) {
        Router.replace("/auth")
        return false
    },
    retry: 5,
    retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
    experimental_prefetchInRender: true,
    enabled: get(sessionExistsAtom),
    // Head-of-line gate for the level-2 fanout: paint from disk, always revalidate
    // (no staleTime ⇒ restored data is stale ⇒ one background refetch). Logout
    // clears the IDB store, and nullish results are never persisted.
    persister: catalogPersister.persisterFn<User | null, QueryKey>,
}))

const logProfile = process.env.NEXT_PUBLIC_LOG_PROFILE_ATOMS === "true"
logAtom(profileQueryAtom, "profileQueryAtom", logProfile)

export const userAtom = atom<User | null>((get) => {
    const res = get(profileQueryAtom).data

    // In test environment, provide a mock user if no real user is available
    if (!res && typeof process !== "undefined" && process.env.NODE_ENV === "test") {
        return {
            id: process.env.VITEST_TEST_USER_ID || "test-user-id",
            username: "test-user",
            email: "test@agenta.ai",
        } as User
    }

    return res ?? null
})
