/**
 * GitHub repo filters in an event's `trigger_config`.
 *
 * Most Composio GitHub triggers take `owner` and a bare `repo` name, but some
 * (GITHUB_PULL_REQUEST_CREATED) want `repo` as `owner/repo` and ignore `owner`
 * once `repo` is set. Those fields say so only in their description, so a bare
 * name typed next to an owner is joined here instead of becoming a filter that
 * matches nothing.
 */

const OWNER_REPO_FORMAT = /owner\/repo\W{0,2}\s+format/i

/** Whether a schema property asks for its value in `owner/repo` form. */
function wantsOwnerRepo(property: unknown): boolean {
    if (!property || typeof property !== "object") return false
    const description = (property as {description?: unknown}).description
    return typeof description === "string" && OWNER_REPO_FORMAT.test(description)
}

/** Joins a bare repo name with the `owner` value where the schema wants `owner/repo`. */
export function normalizeRepoFilters(
    schema: Record<string, unknown> | null | undefined,
    values: Record<string, unknown>,
): Record<string, unknown> {
    const properties = schema?.properties
    const owner = typeof values.owner === "string" ? values.owner.trim() : ""
    if (!properties || typeof properties !== "object" || !owner) return values

    let next = values
    for (const [key, property] of Object.entries(properties)) {
        const value = values[key]
        if (typeof value !== "string" || !wantsOwnerRepo(property)) continue
        const repo = value.trim()
        if (!repo || repo.includes("/")) continue
        next = {...next, [key]: `${owner}/${repo}`}
    }
    return next
}
