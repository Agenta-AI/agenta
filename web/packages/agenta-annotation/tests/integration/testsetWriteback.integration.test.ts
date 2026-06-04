/**
 * Integration tests for the annotation-queue → testset write-back (AGE-3761).
 *
 * These exercise the real write-back primitives against a running Agenta
 * backend, reproducing the "annotated testcases are duplicated in testsets"
 * flow end-to-end at the testset layer:
 *
 *   createTestset → annotate (patchRevision replace) → annotate again →
 *   archive the head revision → save again
 *
 * The suite is skipped automatically unless AGENTA_API_URL + AGENTA_AUTH_KEY
 * are provided (globalSetup mints an ephemeral account + API key from them).
 *
 *   AGENTA_API_URL=http://localhost/api \
 *   AGENTA_AUTH_KEY=<admin key> \
 *   pnpm --filter @agenta/annotation run test:integration
 *
 * What each test pins down (the hypotheses confirmed during the investigation):
 *   • base completeness — the revision fetch returns ALL testcases of a
 *     multi-row revision (so matching has the full base to match against).
 *   • dedup survival — normalizeRevision() STRIPS `testcase_dedup_id`; base
 *     rows used for matching must be read RAW or the dedup fallback can never
 *     fire. This was the production cause of duplication on the second save.
 *   • archived-latest leak — `retrieve {testset_ref}` returns an archived head
 *     revision as "latest", while `fetchLatestRevision` (query path) excludes
 *     it. The fix resolves the base through the query path so the commit never
 *     bases on an archived revision.
 *   • no duplication — the full annotate→annotate→archive→re-save flow keeps
 *     the row count stable, and re-saving unchanged annotations is idempotent.
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {describe, it, expect, beforeEach, afterEach} from "vitest"

import {
    createTestset,
    archiveTestsets,
    archiveRevision,
    fetchLatestRevision,
    fetchLatestRevisionWithTestcases,
    fetchRevisionWithTestcases,
    patchRevision,
} from "@agenta/entities/testset"

import {buildAddToTestsetOperations, getTestcaseDedupId} from "../../src/state/testsetSync"

import {hasBackend, TEST_CONFIG} from "./helpers/env"

const COUNTRIES = ["Nauru", "Tuvalu", "Palau", "Brunei", "Monaco", "Kiribati", "Tonga"]

type RevRow = {id?: string | null; data?: Record<string, unknown> | null}

/** A row as the annotation queue exports it: the ORIGINAL testcase id, its
 * dedup id, and the (annotated) data blob. The queue references the original
 * testcase ids/dedups for the whole session — they do not change as the testset
 * is revised. */
interface QueueRow {
    rowId: string
    dedupId: string | null
    data: Record<string, unknown>
}

/**
 * Read RAW testcases for a revision (dedup id preserved).
 *
 * This mirrors the FIXED controller `fetchBaseRevisionRows`: it must NOT go
 * through fetchRevisionWithTestcases, whose normalizeRevision() strips
 * `testcase_dedup_id` — the very key the matching depends on.
 */
async function readRawRows(revisionId: string): Promise<RevRow[]> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/testsets/revisions/query`,
        {testset_revision_refs: [{id: revisionId}], windowing: {limit: 1}},
        {params: {project_id: TEST_CONFIG.projectId, include_testcases: true}},
    )
    const revision = response.data?.testset_revisions?.[0]
    return (revision?.data?.testcases ?? []) as RevRow[]
}

function countryOf(row: RevRow): unknown {
    return (row.data ?? {}).country
}

async function latestRevisionId(testsetId: string): Promise<string> {
    const latest = await fetchLatestRevision({projectId: TEST_CONFIG.projectId, testsetId})
    if (!latest?.id) throw new Error("could not resolve latest revision")
    return latest.id
}

/**
 * Mirror of the controller's existing-testset write-back path
 * (addScenariosToTestsetAtom → runExport): resolve the base revision through
 * `fetchLatestRevision` (excludes archived), read the complete RAW base rows
 * (dedup preserved), build the delta with `buildAddToTestsetOperations`, and
 * commit — skipping the commit entirely when the delta is empty.
 */
async function writeBack(testsetId: string, queueRows: QueueRow[]) {
    const baseId = await latestRevisionId(testsetId)
    const baseRows = await readRawRows(baseId)

    const commitRows = queueRows.map((row) => {
        const dedupId = row.dedupId ?? getTestcaseDedupId(row.data)
        const data =
            dedupId && row.data.testcase_dedup_id === undefined
                ? {...row.data, testcase_dedup_id: dedupId}
                : row.data
        return {rowId: row.rowId, dedupId, data}
    })

    const operations = buildAddToTestsetOperations({rows: commitRows, baseRows})

    const hasChanges = Boolean(operations.rows?.replace?.length || operations.rows?.add?.length)
    if (!hasChanges) {
        return {baseId, operations, newRevisionId: baseId, committed: false}
    }

    const res = await patchRevision({
        projectId: TEST_CONFIG.projectId,
        testsetId,
        baseRevisionId: baseId,
        operations,
        message: "annotation write-back",
    })

    return {
        baseId,
        operations,
        newRevisionId: (res as {testset_revision?: {id?: string}})?.testset_revision?.id ?? null,
        committed: true,
    }
}

/** Build queue rows from a revision's RAW rows, annotating the given columns. */
function buildQueueRows(rows: RevRow[], annotate: Record<string, unknown> = {}): QueueRow[] {
    return rows.map((row) => {
        const data = row.data ?? {}
        return {
            rowId: row.id as string,
            dedupId: getTestcaseDedupId(data),
            data: {country: data.country, ...annotate},
        }
    })
}

describe.skipIf(!hasBackend)("annotation testset write-back (AGE-3761)", () => {
    let testsetId: string

    beforeEach(async () => {
        const result = await createTestset({
            projectId: TEST_CONFIG.projectId,
            name: `age3761-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            testcases: COUNTRIES.map((country) => ({country})),
            commitMessage: "v1",
        })
        const id = result?.testset?.id
        if (!id) throw new Error("createTestset returned no id")
        testsetId = id
    })

    afterEach(async () => {
        if (testsetId) {
            await archiveTestsets({projectId: TEST_CONFIG.projectId, testsetIds: [testsetId]})
        }
    })

    it("the revision fetch returns ALL testcases (base completeness)", async () => {
        const rows = await readRawRows(await latestRevisionId(testsetId))
        expect(rows).toHaveLength(COUNTRIES.length)
        expect(rows.map(countryOf).sort()).toEqual([...COUNTRIES].sort())
    })

    it("base rows must be read raw — normalizeRevision strips testcase_dedup_id", async () => {
        const revId = await latestRevisionId(testsetId)

        // Raw rows carry the dedup id (matching depends on it).
        const raw = await readRawRows(revId)
        expect(raw.every((r) => getTestcaseDedupId(r.data) !== null)).toBe(true)

        // The normalized fetch strips it — using these as base rows would break
        // the dedup fallback (the production bug).
        const normalized = await fetchRevisionWithTestcases({
            id: revId,
            projectId: TEST_CONFIG.projectId,
        })
        const normalizedRows = (normalized?.data?.testcases ?? []) as RevRow[]
        expect(normalizedRows.every((r) => getTestcaseDedupId(r.data) === null)).toBe(true)
    })

    it("fetchLatestRevision excludes an archived head revision (the fix)", async () => {
        const v1Id = await latestRevisionId(testsetId)
        const v1Rows = await readRawRows(v1Id)

        // Annotate one row → new head revision.
        const nauru = v1Rows.find((r) => countryOf(r) === "Nauru")!
        const commit = await writeBack(testsetId, [
            {
                rowId: nauru.id as string,
                dedupId: getTestcaseDedupId(nauru.data),
                data: {country: "Nauru", quality: 5},
            },
        ])
        const headId = commit.newRevisionId!
        expect(headId).toBeTruthy()
        expect(headId).not.toBe(v1Id)

        await archiveRevision({projectId: TEST_CONFIG.projectId, revisionId: headId})

        // The fix path (query, descending) must NOT return the archived head.
        const fixedLatest = await fetchLatestRevision({projectId: TEST_CONFIG.projectId, testsetId})
        expect(fixedLatest!.id).not.toBe(headId)
        expect(fixedLatest!.id).toBe(v1Id)

        // Document the backend divergence the fix routes around: the
        // `retrieve {testset_ref}` path STILL returns the archived head.
        const buggyLatest = await fetchLatestRevisionWithTestcases({
            projectId: TEST_CONFIG.projectId,
            testsetId,
            testcaseLimit: 1,
        })
        expect(buggyLatest!.id).toBe(headId)
    })

    it("annotate → annotate → archive → re-save never duplicates rows", async () => {
        const v1Rows = await readRawRows(await latestRevisionId(testsetId))
        // The queue references the ORIGINAL v1 ids/dedups for the whole session.
        const queueAll = buildQueueRows(v1Rows, {quality: 5})
        const queueNauru = queueAll.filter((r) => r.data.country === "Nauru")

        // Step 1: annotate the first scenario, save immediately.
        await writeBack(testsetId, queueNauru)
        expect(await readRawRows(await latestRevisionId(testsetId))).toHaveLength(COUNTRIES.length)

        // Step 2: finish the rest, save everything.
        await writeBack(testsetId, queueAll)
        const afterStep2 = await readRawRows(await latestRevisionId(testsetId))
        expect(afterStep2).toHaveLength(COUNTRIES.length)
        expect(afterStep2.map(countryOf).sort()).toEqual([...COUNTRIES].sort())

        // Step 4: archive the head revision, then save again.
        await archiveRevision({
            projectId: TEST_CONFIG.projectId,
            revisionId: await latestRevisionId(testsetId),
        })
        await writeBack(testsetId, queueAll)
        const final = await readRawRows(await latestRevisionId(testsetId))

        // The whole point of AGE-3761: still exactly 7 rows, one per country.
        expect(final).toHaveLength(COUNTRIES.length)
        expect(final.map(countryOf).sort()).toEqual([...COUNTRIES].sort())
    })

    it("re-saving unchanged annotations is idempotent (empty delta, no new revision)", async () => {
        const v1Rows = await readRawRows(await latestRevisionId(testsetId))
        const queueAll = buildQueueRows(v1Rows, {quality: 5})

        // First save annotates every row.
        await writeBack(testsetId, queueAll)
        const headAfterFirst = await latestRevisionId(testsetId)

        // Second save with identical data must produce no operations and no
        // new revision.
        const second = await writeBack(testsetId, queueAll)
        expect(second.operations.rows?.replace).toBeUndefined()
        expect(second.operations.rows?.add).toBeUndefined()
        expect(second.committed).toBe(false)
        expect(await latestRevisionId(testsetId)).toBe(headAfterFirst)
    })
})
