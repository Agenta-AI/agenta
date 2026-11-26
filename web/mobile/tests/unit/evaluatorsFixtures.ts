/** A small evaluator workspace for the evaluators tests. Names are made up. */

export interface FixtureRevision {
    id: string
    workflow_id: string
    version: number
    created_at: string
    updated_at: string | null
    created_by_id: string
    message: string | null
    data: {uri: string; schemas?: {outputs: unknown}}
    flags: Record<string, boolean>
}

export interface FixtureWorkflow {
    id: string
    name: string
    slug: string
    deleted_at: string | null
    deleted_by_id: string | null
    created_at: string
    flags: Record<string, boolean>
}

const AUTO_URI = "agenta:builtin:auto_exact_match:v0"
const HUMAN_URI = "agenta:builtin:feedback:v0"

export const fixtureWorkflow = (
    id: string,
    name: string,
    deletedAt: string | null = null,
): FixtureWorkflow => ({
    id,
    name,
    slug: `${id}-slug`,
    deleted_at: deletedAt,
    deleted_by_id: deletedAt ? "user-1" : null,
    created_at: "2026-09-01T00:00:00Z",
    flags: {is_evaluator: true},
})

export const fixtureRevisions = (
    workflowId: string,
    versions: number[],
    kind: "automatic" | "human" = "automatic",
): FixtureRevision[] =>
    versions.map((version) => ({
        id: `${workflowId}-r${version}`,
        workflow_id: workflowId,
        version,
        created_at: `2026-09-0${version + 1}T00:00:00Z`,
        updated_at: null,
        created_by_id: "user-1",
        message: version > 0 ? `Commit ${version}` : null,
        data: {
            uri: kind === "human" ? HUMAN_URI : AUTO_URI,
            ...(kind === "human"
                ? {
                      schemas: {
                          outputs: {
                              properties: {rating: {type: "number"}, notes: {type: "string"}},
                          },
                      },
                  }
                : {}),
        },
        flags: {
            is_evaluator: true,
            is_managed: true,
            ...(kind === "human" ? {is_feedback: true} : {}),
        },
    }))

export interface EvaluatorServer {
    workflows: FixtureWorkflow[]
    revisions: FixtureRevision[]
}

/** Two automatic evaluators and one human evaluator. */
export const makeEvaluatorServer = (): EvaluatorServer => ({
    workflows: [
        fixtureWorkflow("w1", "Exact match check"),
        fixtureWorkflow("w2", "Length check"),
        fixtureWorkflow("w3", "Quality rating"),
    ],
    revisions: [
        ...fixtureRevisions("w1", [0, 1, 2, 3]),
        ...fixtureRevisions("w2", [0, 1]),
        ...fixtureRevisions("w3", [0, 1, 2], "human"),
    ],
})

/** Archived evaluators: one automatic (archived later) and one human, one automatic earlier. */
export const makeArchivedServer = (): EvaluatorServer => ({
    workflows: [
        fixtureWorkflow("a1", "Older check", "2026-10-01T00:00:00Z"),
        fixtureWorkflow("a2", "Newer check", "2026-10-05T00:00:00Z"),
        fixtureWorkflow("a3", "Archived rating", "2026-10-03T00:00:00Z"),
    ],
    revisions: [
        ...fixtureRevisions("a1", [0, 1]),
        ...fixtureRevisions("a2", [0, 1, 2]),
        ...fixtureRevisions("a3", [0, 1], "human"),
    ],
})

/** The latest revision of each workflow, as `fetchWorkflowsBatch` answers. */
export const latestByWorkflow = (revisions: FixtureRevision[]): Map<string, FixtureRevision> => {
    const latest = new Map<string, FixtureRevision>()
    for (const revision of revisions) {
        const current = latest.get(revision.workflow_id)
        if (!current || revision.version > current.version)
            latest.set(revision.workflow_id, revision)
    }
    return latest
}
