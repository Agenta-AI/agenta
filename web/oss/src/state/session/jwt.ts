import {atomWithQuery} from "jotai-tanstack-query"

import {getJWT} from "@/oss/services/api"

import {sessionExistsAtom} from "./atoms"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * jwtReadyAtom becomes `true` once a non-empty JWT is available in SuperTokens storage.
 * On reload, SuperTokens can report that a session exists before the access
 * token is readable, so this query waits briefly instead of caching `false`.
 */
export const jwtReadyAtom = atomWithQuery<boolean>((get) => ({
    queryKey: ["jwt-ready"],
    queryFn: async () => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const token = await getJWT()
            if (token) return true

            if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
                return !!(process.env.VITEST_TEST_JWT || process.env.TEST_JWT)
            }

            await wait(100)
        }

        return false
    },
    enabled:
        get(sessionExistsAtom) ||
        (typeof process !== "undefined" && process.env.NODE_ENV === "test"),
    experimental_prefetchInRender: true,
    // JWT rarely changes; cache for a while to avoid extra lookups
    staleTime: 1000 * 60 * 10,
    // Keep polling while not ready so a late-arriving token flips this to true
    // instead of leaving downstream gates stuck on a cached false.
    refetchInterval: (query: any) => (query.state.data ? false : 1000),
}))
