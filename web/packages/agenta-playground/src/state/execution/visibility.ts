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
 * Split the referenced + testcase universe into `inputs` (referenced, with
 * draft annotation for missing) and `unreferencedColumns` (in testcase but
 * not referenced).
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
            return {name, value: testcaseData[name]}
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
