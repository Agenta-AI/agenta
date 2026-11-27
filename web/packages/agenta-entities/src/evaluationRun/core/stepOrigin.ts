/**
 * The one test for a human evaluator: the origin of its annotation step (`RunStep.origin`).
 * Human values show apart and never count in "Passed X of Y".
 *
 * @packageDocumentation
 */

/** True only for origin `human`; `auto`, `custom` and no origin are not human. */
export const isHumanOrigin = (origin: string | null | undefined): boolean => origin === "human"

/** Split items by `isHumanOrigin`, each half in input order. */
export function splitByOrigin<T extends {origin?: string | null}>(
    items: readonly T[],
): {human: T[]; notHuman: T[]} {
    const human: T[] = []
    const notHuman: T[] = []
    for (const item of items) (isHumanOrigin(item.origin) ? human : notHuman).push(item)
    return {human, notHuman}
}
