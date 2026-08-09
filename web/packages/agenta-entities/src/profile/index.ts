import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import type {User} from "@agenta/shared/types"
import {useQuery} from "@tanstack/react-query"

/** GET the signed-in user. `ignoreAxiosError` suppresses the global toast for callers that
 * handle 401 themselves (the desktop treats it as "signed out", not a failure). */
export const fetchProfile = async (ignoreAxiosError = false) =>
    axios.get(`${getAgentaApiUrl()}/profile`, {_ignoreError: ignoreAxiosError} as never)

export interface UseProfileOptions {
    /** Skip the request until the host knows a session exists. */
    enabled?: boolean
}

/**
 * The signed-in user, for surfaces that just need to show who you are.
 *
 * Deliberately thinner than the desktop's profile atom, which additionally persists to disk,
 * gates a fanout and redirects on failure — app concerns. A 401 resolves to `null` (signed
 * out) rather than throwing, so a host can render a signed-out state without a error boundary.
 */
export const useProfile = ({enabled = true}: UseProfileOptions = {}) => {
    const query = useQuery<User | null>({
        queryKey: ["profile"],
        queryFn: async () => {
            try {
                const res = await fetchProfile(true)
                return (res?.data as User) ?? null
            } catch (error) {
                if ((error as {response?: {status?: number}})?.response?.status === 401) return null
                throw error
            }
        },
        enabled,
        staleTime: 60_000,
    })

    return {user: query.data ?? null, isPending: query.isPending, error: query.error}
}
