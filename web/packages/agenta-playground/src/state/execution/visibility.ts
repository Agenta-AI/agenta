/**
 * Pure split logic for the playground inputs visibility rule.
 *
 * Given the template-referenced variable names and the testcase data,
 * produces the three-way view the playground inputs body needs:
 *
 *   - `inputs`             : referenced variables, each carrying its testcase
 *                            value (or `undefined` + `isDraft: true` when the
 *                            template references it but the testcase has no
 *                            column yet).
 *   - `unreferencedColumns`: testcase columns the prompt chain does NOT
 *                            reference. Rendered under a collapsed footer in
 *                            the UI so the row stays focused on what the
 *                            prompt actually consumes.
 *
 * The atom layer (`selectors.ts`) wraps this with the live atom sources;
 * keeping the pure helper here lets us unit-test the rule without a Jotai
 * store. See approved design doc, Step 4 (variable visibility rule):
 *   ~/.gstack/projects/Agenta-AI-agenta/ardaerzin-playground-mustache-input-ux-design-*.md
 *
 * NOTE: `isSystemField` filtering is intentionally NOT done here — the atom
 * layer trims system fields out of the testcase data dict before calling
 * this helper, so the rule stays purely about referenced vs not.
 */

export interface VariableEntry {
    name: string
    value: unknown
    /** True when the prompt references the name but the testcase has no
     *  column for it yet — UI renders a draft card. */
    isDraft?: boolean
}

export interface InputsVisibility {
    /** Referenced variables, in the order the caller supplied them. Draft
     *  entries carry `value: undefined` and `isDraft: true`. */
    inputs: VariableEntry[]
    /** Testcase columns NOT in the referenced set. Order preserved from
     *  `testcaseData` iteration. */
    unreferencedColumns: {name: string; value: unknown}[]
}

export interface SplitInputsVisibilityArgs {
    /** Names the prompt / evaluator chain references. Order is preserved in
     *  the `inputs` output. */
    referencedKeys: string[]
    /** Current testcase row data. */
    testcaseData: Record<string, unknown>
}

/**
 * True when a testcase value is "unauthored" — should drive the `[draft]`
 * badge. Treats every form of emptiness as unauthored:
 *
 *   - `undefined` / `null`
 *   - `""` (empty string)
 *   - `{}` (empty plain object)
 *   - `[]` (empty array)
 *
 * `0` and `false` are NOT empty — they're legitimate user values for
 * number / boolean ports.
 *
 * Background: object-typed ports (e.g. `geo` referenced via `{{geo.region}}`,
 * `repos` referenced as `{{#repos}}…`) get auto-seeded with an empty `{}`
 * when the testcase column is created, while string ports stay missing
 * until the user types. Checking `name in testcaseData` alone treated the
 * auto-seeded empty objects as authored — so `geo`/`repos` rendered without
 * a draft badge while `name`/`user` got one, even though all four were
 * equally unfilled by the user (Arda QA 2026-06-02).
 */
function isValueUnauthored(value: unknown): boolean {
    if (value === undefined || value === null || value === "") return true
    if (Array.isArray(value)) return value.length === 0
    if (typeof value === "object") return Object.keys(value as object).length === 0
    return false
}

/**
 * Split the referenced + testcase universe into `inputs` (referenced, with
 * draft annotation for missing OR empty values) and `unreferencedColumns`
 * (in testcase but not referenced).
 *
 * Pure — no atoms, no React, no jotai. Easy to unit-test.
 */
export function splitInputsVisibility({
    referencedKeys,
    testcaseData,
}: SplitInputsVisibilityArgs): InputsVisibility {
    const refsSet = new Set(referencedKeys)

    const inputs: VariableEntry[] = referencedKeys.map((name) => {
        if (name in testcaseData) {
            const value = testcaseData[name]
            // Key exists but the value is empty — surface the draft badge
            // so the UX is consistent with truly-missing columns. Both
            // routes (draft vs filled) write through the same
            // `setCellValue` reducer downstream, so the change is purely
            // visual: same write path, more honest "you haven't filled
            // this yet" affordance.
            if (isValueUnauthored(value)) return {name, value, isDraft: true}
            return {name, value}
        }
        return {name, value: undefined, isDraft: true}
    })

    const unreferencedColumns: {name: string; value: unknown}[] = []
    for (const [name, value] of Object.entries(testcaseData)) {
        if (refsSet.has(name)) continue
        unreferencedColumns.push({name, value})
    }

    return {inputs, unreferencedColumns}
}
