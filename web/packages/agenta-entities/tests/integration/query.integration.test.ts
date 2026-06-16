/**
 * Integration tests for the query entity (saved trace filters) — data atoms and
 * the registry's read/archive logic, exercised against a REAL running Agenta
 * backend. There are NO mocks here: every assertion below round-trips through
 * actual HTTP. The whole suite is `describe.skipIf(!hasBackend)`, so when no
 * backend is configured it SKIPS (it never passes against a mock). Compare with
 * tests/unit/query/*, which mock `getAgentaSdkClient` and assert request shape.
 *
 * The Fern client used by these api functions is authenticated from the
 * ephemeral account credentials provisioned in setup/global.ts + setup/worker.ts
 * (AGENTA_API_KEY / AGENTA_HOST). Each `createIntegrationStore()` builds a real
 * TanStack QueryClient (staleTime 0), so `queryMolecule.atoms.query` performs a
 * live network fetch.
 *
 * Coverage:
 *   • queryMolecule.atoms.query / serverData  — head revision from the real API
 *   • queryMolecule.atoms.isDirty + reducers  — update/discard round-trip
 *   • querySimpleQueries                       — created query appears in the list
 *   • queryRevisionsForQueries                 — head + history after a commit
 *   • archive/unarchive a single revision      — includeArchived split (the
 *                                                Archived-tab logic we ship)
 *   • archive/unarchive the whole query        — active vs archived list split
 */

import {describe, it, expect, beforeEach, afterEach} from "vitest"

import {
    queryMolecule,
    commitQueryRevision,
    querySimpleQueries,
    queryRevisionsForQueries,
    archiveQueryRevision,
    unarchiveQueryRevision,
    archiveSimpleQuery,
} from "../../src/query"

import {hasBackend} from "./helpers/env"
import {makeQueryFixture, type QueryFixture} from "./helpers/fixtures"
import {createIntegrationStore, waitForAtom} from "./helpers/store"

const PROJECT_ID = process.env.AGENTA_TEST_PROJECT_ID || ""

const firstConditionField = (filtering: unknown): string | undefined => {
    const conditions = (filtering as {conditions?: {field?: string}[]} | null)?.conditions
    return conditions?.[0]?.field
}

describe.skipIf(!hasBackend)("query entity integration (real API)", () => {
    let fixture: QueryFixture

    beforeEach(async () => {
        fixture = await makeQueryFixture()
    })

    afterEach(async () => {
        await fixture.cleanup()
    })

    // ── Molecule data atoms ─────────────────────────────────────────────────────

    it("atoms.query resolves from pending to settled against the live backend", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = queryMolecule.atoms.query(fixture.queryId)
        const settled = await waitForAtom<{isPending: boolean}>(
            store,
            queryAtom,
            (q) => !q.isPending,
        )

        expect(settled.isPending).toBe(false)
    })

    it("atoms.serverData returns the created head revision with its filtering round-tripped", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = queryMolecule.atoms.query(fixture.queryId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        const serverData = store.get(queryMolecule.atoms.serverData(fixture.queryId))
        expect(serverData).not.toBeNull()
        expect(serverData?.name).toBe(fixture.name)
        // Filtering persisted to the backend and came back on the head revision.
        expect(firstConditionField(serverData?.data?.filtering)).toBe("trace_type")
    })

    it("atoms.isDirty is false on a freshly fetched query; update/discard round-trips", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = queryMolecule.atoms.query(fixture.queryId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        expect(store.get(queryMolecule.atoms.isDirty(fixture.queryId))).toBe(false)

        store.set(queryMolecule.reducers.update, fixture.queryId, {name: "Updated Name"})
        expect(store.get(queryMolecule.atoms.isDirty(fixture.queryId))).toBe(true)
        expect(store.get(queryMolecule.atoms.data(fixture.queryId))?.name).toBe("Updated Name")

        store.set(queryMolecule.reducers.discard, fixture.queryId)
        expect(store.get(queryMolecule.atoms.isDirty(fixture.queryId))).toBe(false)
        expect(store.get(queryMolecule.atoms.data(fixture.queryId))?.name).toBe(fixture.name)
    })

    // ── List + revision-history fetchers (back the registry table) ──────────────

    it("querySimpleQueries lists the created query among the project's active queries", async () => {
        const response = await querySimpleQueries({projectId: PROJECT_ID})
        const ids = (response.queries ?? []).map((q) => q.id)
        expect(ids).toContain(fixture.queryId)
    })

    it("queryRevisionsForQueries returns head + history newest-first after a commit", async () => {
        // Need the variant to commit onto; resolve from the head revision if the
        // create response did not inline it.
        const {store} = createIntegrationStore()
        const queryAtom = queryMolecule.atoms.query(fixture.queryId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)
        const head = store.get(queryMolecule.atoms.serverData(fixture.queryId))
        const variantId = fixture.variantId ?? head?.variant_id ?? head?.query_variant_id ?? null
        expect(variantId).toBeTruthy()

        await commitQueryRevision({
            projectId: PROJECT_ID,
            variantId: variantId as string,
            data: {
                filtering: {
                    conditions: [{field: "trace_type", operator: "is", value: "completion"}],
                } as never,
            },
            name: fixture.name,
            message: "integration: second revision",
        })

        const revs = await queryRevisionsForQueries({
            projectId: PROJECT_ID,
            queryIds: [fixture.queryId],
        })
        // Two revisions now exist: the new head plus the original.
        expect(revs.length).toBeGreaterThanOrEqual(2)
        expect(revs.every((r) => r.queryId === fixture.queryId)).toBe(true)
        // Distinct revision ids, none archived.
        expect(new Set(revs.map((r) => r.revisionId)).size).toBe(revs.length)
        expect(revs.every((r) => r.deletedAt === null)).toBe(true)
    })

    // ── Per-revision archive / restore (the Archived-tab split we ship) ─────────

    it("archiving one revision removes it from the active history and surfaces it under includeArchived", async () => {
        const {store} = createIntegrationStore()
        const queryAtom = queryMolecule.atoms.query(fixture.queryId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)
        const head = store.get(queryMolecule.atoms.serverData(fixture.queryId))
        const variantId = fixture.variantId ?? head?.variant_id ?? head?.query_variant_id ?? null
        expect(variantId).toBeTruthy()

        // Commit a second revision so there's a non-head revision to archive.
        await commitQueryRevision({
            projectId: PROJECT_ID,
            variantId: variantId as string,
            data: {filtering: fixture.filtering as never},
            name: fixture.name,
            message: "integration: revision to archive",
        })

        const before = await queryRevisionsForQueries({
            projectId: PROJECT_ID,
            queryIds: [fixture.queryId],
        })
        // Archive the oldest revision (the original head before the commit).
        const target = before[before.length - 1]
        expect(target?.revisionId).toBeTruthy()

        await archiveQueryRevision({projectId: PROJECT_ID, revisionId: target.revisionId})

        // Active history (no includeArchived) no longer contains the archived revision.
        const active = await queryRevisionsForQueries({
            projectId: PROJECT_ID,
            queryIds: [fixture.queryId],
        })
        expect(active.map((r) => r.revisionId)).not.toContain(target.revisionId)

        // includeArchived surfaces it, marked with a deletedAt — exactly what the
        // Archived tab filters on (deletedAt && version > 0).
        const withArchived = await queryRevisionsForQueries({
            projectId: PROJECT_ID,
            queryIds: [fixture.queryId],
            includeArchived: true,
        })
        const archivedRev = withArchived.find((r) => r.revisionId === target.revisionId)
        expect(archivedRev).toBeDefined()
        expect(archivedRev?.deletedAt).not.toBeNull()

        // Restore returns it to the active history.
        await unarchiveQueryRevision({projectId: PROJECT_ID, revisionId: target.revisionId})
        const restored = await queryRevisionsForQueries({
            projectId: PROJECT_ID,
            queryIds: [fixture.queryId],
        })
        expect(restored.map((r) => r.revisionId)).toContain(target.revisionId)
    })

    // ── Whole-query archive / restore (active vs archived list split) ───────────

    it("archiving the query moves it from the active list to the archived list", async () => {
        // Sanity: starts active, not archived.
        const activeBefore = await querySimpleQueries({projectId: PROJECT_ID})
        expect((activeBefore.queries ?? []).map((q) => q.id)).toContain(fixture.queryId)

        await archiveSimpleQuery({projectId: PROJECT_ID, queryId: fixture.queryId})

        // Active list (no includeArchived) excludes the archived query.
        const activeAfter = await querySimpleQueries({projectId: PROJECT_ID})
        const activeAfterRow = (activeAfter.queries ?? []).find(
            (q) => q.id === fixture.queryId && !q.deleted_at,
        )
        expect(activeAfterRow).toBeUndefined()

        // includeArchived surfaces it with a deleted_at marker (the Archived tab).
        const withArchived = await querySimpleQueries({
            projectId: PROJECT_ID,
            includeArchived: true,
        })
        const archivedRow = (withArchived.queries ?? []).find((q) => q.id === fixture.queryId)
        expect(archivedRow).toBeDefined()
        expect(archivedRow?.deleted_at).toBeTruthy()
    })
})
