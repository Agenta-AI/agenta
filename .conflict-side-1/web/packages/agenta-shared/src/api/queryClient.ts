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
