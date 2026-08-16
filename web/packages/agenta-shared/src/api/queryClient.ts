import {QueryClient} from "@tanstack/react-query"

// Shared singleton QueryClient so non-React utilities (e.g., API helpers) can
// invalidate / refetch queries after server-side mutations.
// _app.tsx and any hook/component should import this instance.

export const queryClient = new QueryClient()

queryClient.setDefaultOptions({
    queries: {
        experimental_prefetchInRender: true,
    },
})

let hostClientChecked = false

/**
 * Dev-only: a host that installs its own QueryClient makes every package-layer write a silent no-op.
 */
export const assertHostQueryClient = (resolveHostClient: () => QueryClient) => {
    if (hostClientChecked) return
    if (process.env.NODE_ENV === "production") return
    if (typeof window === "undefined") return
    hostClientChecked = true
    // Deferred, then re-checked, so a host that hydrates queryClientAtom late is not flagged.
    const check = (retry: boolean) => {
        if (resolveHostClient() === queryClient) return
        if (retry) {
            setTimeout(() => check(false), 1000)
            return
        }
        console.error(
            "[@agenta/shared] Host QueryClient mismatch: the client in `queryClientAtom` is not the " +
                "`queryClient` singleton from '@agenta/shared/api'. Package-layer cache writes " +
                "(invalidateQueries / setQueryData) address a different cache and do nothing. The host " +
                "must pass that singleton to <QueryClientProvider> and hydrate `queryClientAtom` with it.",
        )
    }
    setTimeout(() => check(true), 0)
}
