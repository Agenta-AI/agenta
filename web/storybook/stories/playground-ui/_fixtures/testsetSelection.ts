/**
 * Query fixtures for the testset-selection surfaces (`LoadModeContent` and the modal that
 * wraps it). Extracted so the modal story cannot drift from the body story's seed set.
 *
 * Every key here was found by the console loop, not by reading the source: render the story,
 * read `[withAgentaData] no fixture for queryKey — add it to parameters.agenta.queries`, add
 * the key it names, repeat until the console is quiet. See `LoadModeContent.stories.tsx` for
 * the full write-up, including why these stories must also set `session: false`.
 */

type QueryFixture = [unknown[], unknown]

export const ts = (id: string, name: string, description?: string) => ({
    id,
    name,
    description: description ?? null,
    created_at: "2026-07-01T09:00:00Z",
    updated_at: "2026-07-14T16:30:00Z",
})

/** Shape is the mapped one the query builds, not the raw API row (testset store.ts:420). */
export const rev = (id: string, version: string, message: string) => ({
    id,
    version,
    created_at: "2026-07-14T16:30:00Z",
    message,
    author: "ashraf",
})

/**
 * `testcasePaginatedStore` keys its query as
 * `["testcase-paginated", scopeId, cursor, limit, offset, …, JSON.stringify(meta)]`.
 * The meta string is compared by value, so this order has to match what the store serialises —
 * copy it from the console warning rather than retyping it.
 */
export const paginatedKey = (scopeId: string, projectId: string, revisionId: string) => [
    "testcase-paginated",
    scopeId,
    null,
    100,
    0,
    null,
    null,
    JSON.stringify({projectId, revisionId, searchTerm: "", _refreshTrigger: 0}),
]

/** `fetchTestcasesWindow` returns row IDENTITIES only — cell values live in their own cache. */
export const page = (ids: string[]) => ({
    rows: ids.map((id) => ({id})),
    totalCount: ids.length,
    hasMore: false,
    nextCursor: null,
    nextOffset: null,
    nextWindowing: null,
})

/**
 * The paginated page carries IDs only, so the table renders empty rows until each testcase
 * entity is seeded too. Nothing warns about these: the entity query is
 * `enabled: … && !cachedData`, so an unseeded row renders blank rather than fetching. The
 * console loop finds keys that FETCH; a blank render is the tell for the ones that do not.
 */
export const testcaseEntities = (
    projectId: string,
    rows: {id: string; data: Record<string, unknown>}[],
): QueryFixture[] => rows.map((row) => [["testcase", projectId, row.id], row])

/**
 * Every scope the picker drives. `load-mode-*` is the preview table and `testcase-selection-*`
 * the selection draft; `edit-mode-*` is a THIRD scope that only appears once the modal is opened
 * with a connected revision — it 404'd the first time the edit-mode story ran, which is how it
 * was found.
 */
export const testcasePages = (
    projectId: string,
    revisionId: string,
    ids: string[],
): QueryFixture[] =>
    ["load-mode", "testcase-selection", "edit-mode"].map((scope) => [
        paginatedKey(`${scope}-${revisionId}`, projectId, revisionId),
        page(ids),
    ])

export const SUPPORT_ROWS = [
    {id: "tc-1", data: {question: "Where is my refund?", expected: "billing"}},
    {id: "tc-2", data: {question: "Reset my password", expected: "account"}},
    {id: "tc-3", data: {question: "Charged twice this month", expected: "billing"}},
    {id: "tc-4", data: {question: "Does the API support webhooks?", expected: "product"}},
]

/** The full populated seed: three testsets, the first one's revisions, and its testcases. */
export const populatedTestsetQueries = (projectId: string): QueryFixture[] => [
    [
        ["testsets-list", projectId, ""],
        {
            testsets: [
                ts("ts-support", "Support triage", "Inbound tickets, labelled"),
                ts("ts-claims", "Claims extraction"),
                ts("ts-rag", "RAG regression set", "Golden answers for retrieval"),
            ],
            count: 3,
        },
    ],
    // The sidebar auto-selects the first testset, so its revisions load too...
    [
        ["revisions-list", projectId, "ts-support"],
        [rev("rev-3", "v3", "Add refund cases"), rev("rev-2", "v2", "Relabel spam")],
    ],
    // ...then the latest revision's testcase IDs, in both scopes...
    ...testcasePages(
        projectId,
        "rev-3",
        SUPPORT_ROWS.map((r) => r.id),
    ),
    // ...and the entities those IDs point at, so the cells are not blank.
    ...testcaseEntities(projectId, SUPPORT_ROWS),
]
