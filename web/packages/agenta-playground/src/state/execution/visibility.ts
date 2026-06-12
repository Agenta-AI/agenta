/**
 * Pure split logic for the playground inputs visibility rule.
 *
 * Given the template-referenced variable names and the testcase data,
 * produces the three-way view the playground inputs body needs:
 *
 *   - `inputs`             : referenced variables, each carrying its testcase
 *                            value, or `undefined` when the template references
 *                            it but the testcase has no column yet.
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
    /** UI hint applied by callers when a variable should render a draft badge. */
    isDraft?: boolean
}

export interface InputsVisibility {
    /** Referenced variables, in the order the caller supplied them. */
    inputs: VariableEntry[]
    /** Testcase columns NOT in the referenced set. Order preserved from
     *  `testcaseData` iteration. */
    unreferencedColumns: {name: string; value: unknown}[]
}

export interface SplitInputsVisibilityArgs {
    /** Names the prompt / evaluator chain references. Order is preserved in
     *  the `inputs` output. */
    referencedKeys: string[]
    /** Referenced variables added since the committed workflow revision. */
    draftKeys?: string[]
    /** Current testcase row data. */
    testcaseData: Record<string, unknown>
}

/**
 * Split the referenced + testcase universe into `inputs` (referenced) and
 * `unreferencedColumns` (in testcase but not referenced).
 *
 * Pure — no atoms, no React, no jotai. Easy to unit-test.
 */
export function splitInputsVisibility({
    referencedKeys,
    draftKeys = [],
    testcaseData,
}: SplitInputsVisibilityArgs): InputsVisibility {
    const refsSet = new Set(referencedKeys)
    const draftSet = new Set(draftKeys)

    const inputs: VariableEntry[] = referencedKeys.map((name) => {
        const value = name in testcaseData ? testcaseData[name] : undefined
        return draftSet.has(name) ? {name, value, isDraft: true} : {name, value}
    })

    const unreferencedColumns: {name: string; value: unknown}[] = []
    for (const [name, value] of Object.entries(testcaseData)) {
        if (refsSet.has(name)) continue
        unreferencedColumns.push({name, value})
    }

    return {inputs, unreferencedColumns}
}

export function filterUnreferencedColumnsForSource<T>(
    unreferencedColumns: T[],
    connectedSourceId?: string | null,
): T[] {
    return connectedSourceId ? unreferencedColumns : []
}
