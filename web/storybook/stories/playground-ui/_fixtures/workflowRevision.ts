/**
 * Query fixtures for one workflow revision — what `MetadataSidebar` needs to render.
 *
 * Found by the console loop, not by reading the molecule: render, read
 * `[withAgentaData] no fixture for queryKey`, add the key, repeat. See
 * `LoadModeContent.stories.tsx` for the full write-up.
 */

type QueryFixture = [unknown[], unknown]

export const REVISION_ID = "rev-classify-3"
export const WORKFLOW_ID = "wf-classify"

export const revision = {
    id: REVISION_ID,
    workflow_id: WORKFLOW_ID,
    slug: "classify",
    name: "classify",
    version: 3,
    message: "Add refund intent and relabel the spam bucket.",
    created_at: "2026-07-14T16:30:00Z",
    created_by_id: "user-ashraf",
}

/**
 * `workflowMolecule.selectors.data(id)` reads `["workflows", "revision", id, projectId]`
 * (workflow store.ts:1187). Nothing warns when it is missing — the query is gated on a cache
 * miss, so an unseeded revision makes `MetadataSidebar` return `null` and the story renders an
 * empty page that passes both the VRT and axe. That is the "renders nothing" trap; the
 * render-check is what catches it.
 *
 * `workflowDetailQueryAtomFamily` is keyed by WORKFLOW id, not revision id (store.ts:454).
 */
export const workflowQueries = (projectId: string): QueryFixture[] => [
    [["workflows", "revision", REVISION_ID, projectId], revision],
    [
        ["workflows", "detail", projectId, WORKFLOW_ID],
        {id: WORKFLOW_ID, slug: "classify", name: "classify"},
    ],
]
