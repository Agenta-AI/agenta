import {QueryClient} from "@tanstack/react-query"

/** Single app-wide client; also hydrated into `queryClientAtom` in AppProviders. */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
})
