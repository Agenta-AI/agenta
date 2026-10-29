/**
 * The icon catalog, lazily. Both pickers — the desktop popover and mobile's sheet — load it
 * through here, so they share one chunk and one cache.
 */
import type {PhosphorCatalogEntry} from "./catalog.generated"

export type {PhosphorCatalogEntry} from "./catalog.generated"

/** A REJECTION is deliberately not cached: a chunk that 404s after a deploy would otherwise leave
 * every picker in the session spinning forever with no retry. */
let catalogPromise: Promise<PhosphorCatalogEntry[]> | null = null

export const loadAgentIconCatalog = (): Promise<PhosphorCatalogEntry[]> => {
    catalogPromise ??= import("./catalog.generated")
        .then((mod) => mod.phosphorCatalog)
        .catch((error: unknown) => {
            catalogPromise = null
            throw error
        })
    return catalogPromise
}
