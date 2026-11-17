import type {AppDeploymentRow} from "@agenta/entities/environment"

/** The variant's name as the history shows it: the app's slug prefix is dropped. */
export const variantLabel = (row: AppDeploymentRow, names: ReadonlyMap<string, string>): string => {
    const named = row.variantId ? names.get(row.variantId) : undefined
    if (named) return named
    const slug = row.variantSlug
    if (!slug) return "—"
    return row.appSlug && slug.startsWith(`${row.appSlug}.`)
        ? slug.slice(row.appSlug.length + 1)
        : slug
}
