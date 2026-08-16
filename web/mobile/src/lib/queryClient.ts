import {queryClient} from "@agenta/shared/api"

// The SAME client the packages resolve. Package code no longer touches this singleton: it calls
// `getHostQueryClient()`, which reads whatever the host hydrated into `queryClientAtom`. So the
// contract a host must keep is to pass THIS object to <QueryClientProvider> *and* hydrate the
// atom with it. Install one client and hydrate another and you get two caches — reads served by
// one, package writes landing in the other, every mutation stale until a reload. `/m` is a host.
//
// Mobile's own defaults are merged onto it rather than replacing them: `setDefaultOptions` is a
// whole-object write, so spreading the existing queries preserves what the package layer set.
queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: {
        ...queryClient.getDefaultOptions().queries,
        retry: 1,
        refetchOnWindowFocus: false,
    },
})

/** Single app-wide client; also hydrated into `queryClientAtom` in AppProviders. */
export {queryClient}
