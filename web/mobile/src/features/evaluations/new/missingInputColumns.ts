/** The expected input variables the test set has no column for, in expected order. */
export const missingInputColumns = (
    expected: readonly string[],
    columns: readonly string[],
): string[] => {
    const have = new Set(columns)
    return expected.filter((name) => !have.has(name))
}
