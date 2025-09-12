import {atomWithQuery} from "jotai-tanstack-query"

import {getJWT} from "@/oss/services/api"

import {sessionExistsAtom} from "./atoms"

/**
 * jwtReadyAtom becomes `true` once a non-empty JWT is available in SuperTokens storage.
 * We poll it once on mount; the value is cached as it has an infinite staleTime.
 * Whenever the session starts (sessionExistsAtom true) but JWT is still empty,
 * the query function runs again and resolves when the token appears.
 */
export const jwtReadyAtom = atomWithQuery<boolean>((get) => ({
    queryKey: ["jwt-ready"],
    queryFn: async () => {
        const token = await getJWT()

        // In test environment, consider JWT ready if test JWT is available
        if (!token && typeof process !== "undefined" && process.env.NODE_ENV === "test") {
            return !!(process.env.VITEST_TEST_JWT || process.env.TEST_JWT)
        }

        return !!token
    },
    enabled:
        get(sessionExistsAtom) ||
        (typeof process !== "undefined" && process.env.NODE_ENV === "test"),
    experimental_prefetchInRender: true,
    // JWT rarely changes; cache for a while to avoid extra lookups
    staleTime: 1000 * 60 * 10,
}))
