import type {AppRevisionRow} from "./useAppRevisions"
import type {VariantsDisplayMode} from "./variantsView"

/**
 * A Registry row. In Variants mode a variant shows as one row (its latest revision) that expands
 * to its older revisions, as in the old app. In Revisions mode every revision is a row.
 */
export interface RegistryRow {
    /** The selection and React key: `variant:<id>` for a variant row, else the revision id. */
    key: string
    kind: "variant" | "revision"
    /** The revision the row shows: a variant row shows its latest. */
    revision: AppRevisionRow
    /** An older revision listed under its expanded variant. */
    nested: boolean
    /** On a variant row: how many older revisions it can expand to. */
    olderCount: number
}

export const variantRowKey = (variantId: string) => `variant:${variantId}`

const variantIdOf = (row: AppRevisionRow) => row.variantId || row.variantName

/** The rows in display order. The revisions arrive newest first, so a variant's first is its latest. */
export const toRegistryRows = (
    revisions: readonly AppRevisionRow[],
    mode: VariantsDisplayMode,
    expanded: ReadonlySet<string>,
): RegistryRow[] => {
    if (mode === "revisions") {
        return revisions.map((revision) => ({
            key: revision.revisionId,
            kind: "revision",
            revision,
            nested: false,
            olderCount: 0,
        }))
    }
    const byVariant = new Map<string, AppRevisionRow[]>()
    for (const revision of revisions) {
        const list = byVariant.get(variantIdOf(revision)) ?? []
        list.push(revision)
        byVariant.set(variantIdOf(revision), list)
    }
    return [...byVariant.entries()].flatMap(([variantId, [latest, ...older]]) => [
        {
            key: variantRowKey(variantId),
            kind: "variant" as const,
            revision: latest,
            nested: false,
            olderCount: older.length,
        },
        ...(expanded.has(variantId)
            ? older.map((revision) => ({
                  key: revision.revisionId,
                  kind: "revision" as const,
                  revision,
                  nested: true,
                  olderCount: 0,
              }))
            : []),
    ])
}

/** What a selection deletes: whole variants, and single revisions of the others. */
export interface RegistryDeletion {
    variants: {id: string; name: string}[]
    revisions: AppRevisionRow[]
}

export const toDeletion = (
    rows: readonly RegistryRow[],
    selected: ReadonlySet<string>,
): RegistryDeletion => {
    const picked = rows.filter((row) => selected.has(row.key))
    const variants = picked
        .filter((row) => row.kind === "variant")
        .map((row) => ({id: variantIdOf(row.revision), name: row.revision.variantName}))
    const variantIds = new Set(variants.map((variant) => variant.id))
    const revisions = picked
        .filter((row) => row.kind === "revision" && !variantIds.has(variantIdOf(row.revision)))
        .map((row) => row.revision)
    return {variants, revisions}
}

/** The revision a single selected row stands for, for Deploy; null for none or several. */
export const singleSelectedRevision = (
    rows: readonly RegistryRow[],
    selected: ReadonlySet<string>,
): AppRevisionRow | null => {
    if (selected.size !== 1) return null
    return rows.find((row) => selected.has(row.key))?.revision ?? null
}

/** The two revisions two selected rows stand for, for Compare; null for any other count. */
export const selectedPair = (
    rows: readonly RegistryRow[],
    selected: ReadonlySet<string>,
): [AppRevisionRow, AppRevisionRow] | null => {
    const picked = rows.filter((row) => selected.has(row.key)).map((row) => row.revision)
    return picked.length === 2 && picked[0].revisionId !== picked[1].revisionId
        ? [picked[0], picked[1]]
        : null
}
