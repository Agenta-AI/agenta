/**
 * The add-integration drawer's list arithmetic, kept out of the component so it can be tested.
 *
 * Two rules the drawer used to get wrong:
 * - A connected integration STAYS in the connectable list. Connecting again is how an author gets
 *   a second account, so the catalog never subtracts what is already connected.
 * - Picking a category filters BOTH lists. The catalog is filtered server-side; the connected list
 *   is the project's own connections, so it is filtered here against each integration's categories.
 */

/** The category a rail button stands for. `id` drives the server query, `name` is what apps carry. */
export interface CategorySelection {
    id: string
    name: string
}

const norm = (value: string): string => value.trim().toLowerCase()

/**
 * Whether an integration belongs to the selected category. Integrations carry category NAMES
 * (the provider's own labels); the rail's `id` is the provider's slug for the same thing, so both
 * are accepted — a provider that starts sending one where it sent the other cannot empty the list.
 */
export function matchesCategory(
    categories: readonly string[] | null | undefined,
    selected: CategorySelection | null,
): boolean {
    if (!selected) return true
    if (!categories || categories.length === 0) return false
    const wanted = new Set([norm(selected.name), norm(selected.id)])
    return categories.some((category) => wanted.has(norm(category)))
}

export interface ConnectedGroupLike {
    integrationKey: string
}

export interface ConnectedFilterOptions<T extends ConnectedGroupLike> {
    groups: readonly T[]
    /** The raw search box text. */
    query: string
    category: CategorySelection | null
    /** Categories per integration key, from each integration's catalog detail. */
    categoriesByIntegration: ReadonlyMap<string, readonly string[]>
    /** Display name per integration key, so a search matches what the row actually shows. */
    namesByIntegration?: ReadonlyMap<string, string>
}

/**
 * The connected rows a search and a category leave standing. Filtering here rather than inside each
 * row keeps the section count equal to the rows it heads.
 *
 * An integration whose detail has not loaded yet keeps its row under a category filter: hiding it
 * would make rows blink out and back as details arrive.
 */
export function filterConnectedGroups<T extends ConnectedGroupLike>({
    groups,
    query,
    category,
    categoriesByIntegration,
    namesByIntegration,
}: ConnectedFilterOptions<T>): T[] {
    const needle = norm(query)
    return groups.filter((group) => {
        if (needle) {
            const name = namesByIntegration?.get(group.integrationKey) ?? ""
            const haystack = `${group.integrationKey} ${name}`.toLowerCase()
            if (!haystack.includes(needle)) return false
        }
        if (!category) return true
        const categories = categoriesByIntegration.get(group.integrationKey)
        if (categories === undefined) return true
        return matchesCategory(categories, category)
    })
}

export interface CatalogIntegrationLike {
    key: string
}

/**
 * The drawer's two sections, built together so the relationship between them is stated once.
 *
 * `connectable` is the WHOLE catalog, connected apps included. Subtracting them made a second
 * account unreachable — Connect is the only way to make one and it lives on these rows — so an app
 * the project already has appears twice: under Connected, and again here.
 */
export function catalogSections<G extends ConnectedGroupLike, I extends CatalogIntegrationLike>({
    integrations,
    ...connectedOptions
}: ConnectedFilterOptions<G> & {integrations: readonly I[]}): {
    connected: G[]
    connectable: readonly I[]
} {
    return {connected: filterConnectedGroups(connectedOptions), connectable: integrations}
}
