/** The slug the API stores for a test set name. `cloneTestset` in `@agenta/entities` builds it the same way. */
const slugOf = (name: string): string =>
    name
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_-]/g, "")

/**
 * The name a clone starts with: "{name} (copy)", then "{name} (copy 2)" and so on, taking the
 * first one whose slug is free. `takenSlugs` are the slugs the API reports for the test sets
 * that exist. A renamed test set keeps its old slug, so names alone would miss it.
 */
export function defaultCloneName(name: string, takenSlugs: readonly string[]): string {
    const taken = new Set(takenSlugs)
    let candidate = `${name} (copy)`
    for (let n = 2; taken.has(slugOf(candidate)); n += 1) candidate = `${name} (copy ${n})`
    return candidate
}
