/* eslint-disable @typescript-eslint/no-explicit-any -- relocated eval-run parity data layer (WP-4e-2b); reads dynamic backend-shaped payloads, logic unchanged */
/**
 * Scenario-level testcase entity atoms
 *
 * This module provides atoms to fetch and access testcase entities for evaluation scenarios.
 * It uses the existing testcase entity system from state/entities/testcase for consistency.
 *
 * The key insight is that each scenario has at most one testcase (from input steps),
 * so we fetch it once per scenario and all input columns read from it.
 */

import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import {injectedTestcaseQueryFamilyAtom} from "../../evalRunInjection"

import {activePreviewRunIdAtom} from "./run"
import {scenarioStepsQueryFamily} from "./scenarioSteps"

/**
 * Flattened testcase shape (mirrors `@/oss/state/entities/testcase/schema` `FlattenedTestcase`,
 * defined locally to keep the package free of any `@/oss` import). The eval-run consumers
 * read this as an open record with path-based access, so a permissive record shape suffices.
 */
export type FlattenedTestcase = Record<string, unknown>

/**
 * Extract testcaseId from scenario steps
 * Looks for testcaseId in input steps first, then falls back to any step with testcaseId
 */
const extractTestcaseIdFromSteps = (steps: any[]): string | undefined => {
    if (!steps?.length) return undefined

    // First, try to find testcaseId from input steps
    const inputStepKeys = new Set(["input", "inputs", "testcase", "data"])
    for (const step of steps) {
        const stepKey = step?.stepKey ?? step?.step_key ?? step?.key ?? ""
        if (inputStepKeys.has(stepKey.toLowerCase())) {
            const testcaseId = step?.testcaseId ?? step?.testcase_id
            if (testcaseId) return testcaseId
        }
    }

    // Fallback: check any step for testcaseId
    for (const step of steps) {
        const testcaseId = step?.testcaseId ?? step?.testcase_id
        if (testcaseId) return testcaseId
    }

    return undefined
}

/**
 * Atom family that extracts the testcaseId for a scenario from its steps
 */
export const scenarioTestcaseIdAtomFamily = atomFamily(
    ({scenarioId, runId}: {scenarioId: string; runId?: string | null}) =>
        atom((get): string | undefined => {
            const effectiveRunId = runId ?? get(activePreviewRunIdAtom) ?? undefined
            const stepsQuery = get(scenarioStepsQueryFamily({scenarioId, runId: effectiveRunId}))
            const steps = stepsQuery.data?.steps ?? []
            return extractTestcaseIdFromSteps(steps)
        }),
)

/**
 * Atom family that provides the testcase entity for a scenario
 * Uses the global testcase entity system for consistency and caching
 *
 * Returns null if:
 * - No testcaseId found in scenario steps
 * - Testcase entity not yet loaded
 * - Testcase doesn't exist
 */
export const scenarioTestcaseEntityAtomFamily = atomFamily(
    ({scenarioId, runId}: {scenarioId: string; runId?: string | null}) =>
        atom((get): FlattenedTestcase | null => {
            const testcaseId = get(scenarioTestcaseIdAtomFamily({scenarioId, runId}))
            if (!testcaseId) return null

            // Use the injected testcase query family for caching and consistency.
            const family = get(injectedTestcaseQueryFamilyAtom)
            if (!family) return null
            const query = get(family(testcaseId))
            return (query.data ?? null) as FlattenedTestcase | null
        }),
)

/**
 * Atom family that provides loading/error state for scenario testcase
 */
export const scenarioTestcaseMetaAtomFamily = atomFamily(
    ({scenarioId, runId}: {scenarioId: string; runId?: string | null}) =>
        atom((get) => {
            const effectiveRunId = runId ?? get(activePreviewRunIdAtom) ?? undefined

            // Check if steps are still loading (stale-while-revalidate: only if no data yet)
            const stepsQuery = get(scenarioStepsQueryFamily({scenarioId, runId: effectiveRunId}))
            const hasStepsData = Boolean(stepsQuery.data)
            if (!hasStepsData && (stepsQuery.isLoading || stepsQuery.isPending)) {
                return {
                    isLoading: true,
                    isFetching: stepsQuery.isFetching ?? false,
                    error: undefined,
                    hasTestcase: false,
                }
            }

            const testcaseId = get(scenarioTestcaseIdAtomFamily({scenarioId, runId}))
            if (!testcaseId) {
                return {
                    isLoading: false,
                    isFetching: false,
                    error: undefined,
                    hasTestcase: false,
                }
            }

            // Check testcase query state (stale-while-revalidate: only loading if no data)
            const family = get(injectedTestcaseQueryFamilyAtom)
            if (!family) {
                return {
                    isLoading: false,
                    isFetching: false,
                    error: undefined,
                    hasTestcase: true,
                }
            }
            const testcaseQuery = get(family(testcaseId))
            const hasTestcaseData = Boolean(testcaseQuery.data)
            return {
                isLoading: !hasTestcaseData && (testcaseQuery.isLoading ?? false),
                isFetching: testcaseQuery.isFetching ?? false,
                error: testcaseQuery.error,
                hasTestcase: true,
            }
        }),
)

/**
 * Atom family to get a specific value from the scenario's testcase entity
 * Uses path-based access similar to testcaseCellAtomFamily
 *
 * @param scenarioId - The scenario ID
 * @param runId - Optional run ID
 * @param path - Dot-separated path to the value (e.g., "data.input", "question")
 */
export const scenarioTestcaseValueAtomFamily = atomFamily(
    ({scenarioId, runId, path}: {scenarioId: string; runId?: string | null; path: string}) =>
        selectAtom(
            scenarioTestcaseEntityAtomFamily({scenarioId, runId}),
            (entity): unknown => {
                if (!entity) return undefined

                // Split path and resolve value
                const segments = path.split(".").filter(Boolean)
                let current: unknown = entity

                for (const segment of segments) {
                    if (current === null || current === undefined) return undefined
                    if (typeof current !== "object") return undefined

                    // Handle "data" prefix - testcase data is flattened, so skip "data" segment
                    if (segment === "data" && segments[0] === "data") {
                        // Data is already flattened into entity, continue to next segment
                        continue
                    }

                    current = (current as Record<string, unknown>)[segment]
                }

                return current
            },
            // Use deep equality for complex values
            (a, b) => {
                if (a === b) return true
                if (a === undefined || b === undefined) return a === b
                if (typeof a !== typeof b) return false
                if (typeof a === "object" && a !== null && b !== null) {
                    try {
                        return JSON.stringify(a) === JSON.stringify(b)
                    } catch {
                        return false
                    }
                }
                return a === b
            },
        ),
)

/**
 * Check if a scenario has embedded input data in steps (for online evaluations)
 * Online evaluations may not have testcaseId but have inputs directly in steps
 */
export const scenarioHasEmbeddedInputsAtomFamily = atomFamily(
    ({scenarioId, runId}: {scenarioId: string; runId?: string | null}) =>
        atom((get): boolean => {
            const effectiveRunId = runId ?? get(activePreviewRunIdAtom) ?? undefined
            const stepsQuery = get(scenarioStepsQueryFamily({scenarioId, runId: effectiveRunId}))
            const steps = stepsQuery.data?.steps ?? []

            // Check if any step has embedded inputs
            for (const step of steps) {
                if (step?.inputs && Object.keys(step.inputs).length > 0) {
                    return true
                }
            }

            return false
        }),
)
