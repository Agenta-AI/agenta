import {eagerAtom} from "jotai-eager"
import {atomWithQuery} from "jotai-tanstack-query"
import Router from "next/router"

import {User} from "@/oss/lib/Types"
import {fetchProfile} from "@/oss/services/api"
import {logAtom} from "@/oss/state/utils/logAtom"

import {sessionExistsAtom} from "../../session"

export const profileQueryAtom = atomWithQuery<User>((get) => ({
    queryKey: ["profile"],
    queryFn: async () => {
        const res = await fetchProfile()
        return res.data as User
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

export const userAtom = eagerAtom<User | null>((get) => {
    const res = get(profileQueryAtom).data as User | undefined

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
