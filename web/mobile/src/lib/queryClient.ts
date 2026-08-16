import {queryClient} from "@agenta/shared/api"

// The SAME client the packages resolve. Package code reads it at call time off `queryClientAtom`,
// so a host that installs a client of its own gets working reads and silently dead writes — every
// mutation leaves the list stale until a reload. Hosts pass this singleton and hydrate the atom
// with it; `/m` is a host.
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
