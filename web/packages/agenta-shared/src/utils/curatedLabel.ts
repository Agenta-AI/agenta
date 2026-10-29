/**
 * Curated model labels carry their own aside.
 *
 * The harness catalogs spell a model's label with a trailing parenthetical when the model is worth
 * marking — `Sol (default)`, `Luna (cheapest)`, `Opus (1M context)`. The picker draws that aside in
 * a quieter tone beside the name rather than printing it as part of the name, so the split has to
 * happen wherever a label becomes a row. Deriving it from the label keeps the vocabulary in the
 * catalog: a new aside needs no code change here.
 */

/** A curated label split into the model's name and its quiet trailing aside. */
export interface CuratedLabel {
    name: string
    /** The parenthetical, brackets included, or undefined when the label carries none. */
    hint?: string
}

/** Only a parenthetical that CLOSES the label is an aside; one mid-string belongs to the name. */
const TRAILING_PARENTHETICAL = /^(.*\S)\s*(\([^()]*\))$/

/**
 * Split a curated label into its name and trailing aside.
 *
 * A label that is nothing but a parenthetical, or that has none, comes back whole — there is no
 * name to keep otherwise.
 */
export const splitCuratedLabel = (label: string): CuratedLabel => {
    const match = TRAILING_PARENTHETICAL.exec(label?.trim() ?? "")
    if (!match) return {name: label}
    return {name: match[1], hint: match[2]}
}
