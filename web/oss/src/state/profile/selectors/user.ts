import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"
import Router from "next/router"

import type {AxiosError} from "axios"

import {User} from "@/oss/lib/Types"
import {fetchProfile} from "@/oss/services/api"
import {logAtom} from "@/oss/state/utils/logAtom"

import {sessionExistsAtom} from "../../session"

export const profileQueryAtom = atomWithQuery<User | null>((get) => ({
    queryKey: ["profile"],
    queryFn: async () => {
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
    experimental_prefetchInRender: true,
    enabled: get(sessionExistsAtom),
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
