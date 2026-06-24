/**
 * Integration test fixtures.
 *
 * Each factory creates a real entity via the API and returns its ID alongside
 * a `cleanup` function that archives it. Call cleanup in afterEach to leave
 * the backend in a clean state even when tests fail.
 *
 * Fixture names are timestamped so concurrent runs don't collide.
 */

import {createEnvironment, archiveEnvironment} from "../../../src/environment/api/mutations"
import {createSimpleQuery, archiveSimpleQuery} from "../../../src/query/api/mutations"
import {createTestset, archiveTestsets} from "../../../src/testset/api/mutations"

import {TEST_CONFIG} from "./env"

function tag(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

// ── Testset ───────────────────────────────────────────────────────────────────

export interface TestsetFixture {
    testsetId: string
    revisionId: string
    name: string
    cleanup: () => Promise<void>
}

export async function makeTestsetFixture(
    rows: Record<string, unknown>[] = [{prompt: "hello", expected: "world"}],
): Promise<TestsetFixture> {
    const name = tag("integration-testset")
    const result = await createTestset({
        projectId: TEST_CONFIG.projectId,
        name,
        testcases: rows,
        commitMessage: "integration test seed",
    })

    const testsetId: string =
        result?.testset?.id ??
        (() => {
            throw new Error("createTestset did not return a testset id")
        })()

    const revisionId: string =
        result?.revisionId ??
        (() => {
            throw new Error("createTestset did not return a revisionId")
        })()

    return {
        testsetId,
        revisionId,
        name,
        cleanup: async () => {
            await archiveTestsets({projectId: TEST_CONFIG.projectId, testsetIds: [testsetId]})
        },
    }
}

// ── Environment ───────────────────────────────────────────────────────────────

export interface EnvironmentFixture {
    environmentId: string
    name: string
    slug: string
    cleanup: () => Promise<void>
}

export async function makeEnvironmentFixture(): Promise<EnvironmentFixture> {
    const slug = tag("test-env").replace(/-/g, "_").slice(0, 40)
    const name = tag("integration-environment")

    const env = await createEnvironment({
        projectId: TEST_CONFIG.projectId,
        slug,
        name,
    })

    const environmentId: string =
        env?.id ??
        (() => {
            throw new Error("createEnvironment did not return an id")
        })()

    return {
        environmentId,
        name,
        slug,
        cleanup: async () => {
            await archiveEnvironment(TEST_CONFIG.projectId, environmentId)
        },
    }
}

// ── Query (saved trace filter) ──────────────────────────────────────────────────

/** A simple, structurally-valid filtering payload for query fixtures. */
export const QUERY_FIXTURE_FILTERING = {
    conditions: [{field: "trace_type", operator: "is", value: "invocation"}],
}

export interface QueryFixture {
    queryId: string
    variantId: string | null
    revisionId: string
    name: string
    filtering: unknown
    cleanup: () => Promise<void>
}

export async function makeQueryFixture(
    filtering: unknown = QUERY_FIXTURE_FILTERING,
): Promise<QueryFixture> {
    const name = tag("integration-query")
    const result = await createSimpleQuery({
        projectId: TEST_CONFIG.projectId,
        query: {name, data: {filtering: filtering as never}},
    })

    return {
        queryId: result.queryId,
        variantId: result.variantId,
        revisionId: result.revisionId,
        name,
        filtering,
        cleanup: async () => {
            // Tolerant: a test may have already archived the query (the archive-split
            // case), and re-archiving a soft-deleted artifact is a no-op-or-error.
            try {
                await archiveSimpleQuery({
                    projectId: TEST_CONFIG.projectId,
                    queryId: result.queryId,
                })
            } catch {
                /* already archived — leave the backend clean either way */
            }
        },
    }
}
