/**
 * The slug the API stores for a test set name. It matches `cloneTestset` in `@agenta/entities`,
 * which builds the slug the same way, so two names with the same slug count as the same name.
 */
const slugOf = (name: string): string =>
    name
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_-]/g, "")

/**
 * The name a clone starts with: "{name} (copy)", then "{name} (copy 2)" and so on, taking the
 * first one whose slug no existing test set uses.
 */
export function defaultCloneName(name: string, existingNames: readonly string[]): string {
    const taken = new Set(existingNames.map(slugOf))
    let candidate = `${name} (copy)`
    for (let n = 2; taken.has(slugOf(candidate)); n += 1) candidate = `${name} (copy ${n})`
    return candidate
}
