/**
 * Order-preserving dedupe by a derived key.
 *
 * Guards the catalog lists against duplicate React keys — Composio's categories
 * endpoint returns duplicate slugs, and paginated integration cursors can overlap
 * and repeat an entry. A duplicate `key`/`id` crashes the list render, so both the
 * category and integration hooks funnel their raw server data through this helper.
 * Items whose key is falsy (null/undefined/empty) are dropped along with repeats.
 */
export function dedupeBy<T>(
    items: readonly T[],
    keyOf: (item: T) => string | null | undefined,
): T[] {
    const seen = new Set<string>()
    const out: T[] = []
    for (const item of items) {
        const key = keyOf(item)
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push(item)
    }
    return out
}
