/**
 * The trace or test case id a scenario record points at. Queues store it on the record, in its
 * tags or in its meta, depending on how the item was added.
 */
export const readScenarioRef = (
    scenario: Record<string, unknown> | null | undefined,
    key: "trace_id" | "testcase_id",
): string => {
    if (!scenario) return ""
    for (const source of [scenario, scenario.tags, scenario.meta]) {
        if (!source || typeof source !== "object") continue
        const value = (source as Record<string, unknown>)[key]
        if (typeof value === "string" && value) return value
    }
    return ""
}
