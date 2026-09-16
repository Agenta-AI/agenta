import type {Workflow} from "@agenta/entities/workflow"
import type {QueryKey} from "@tanstack/react-query"

import type {StoryScope} from "../.storybook/decorators/withAgentaData"

const TIMESTAMPS = {
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
} as const

export interface AgentPickerIds {
    projectId: string
    briefingId: string
    writerId: string
    newsId: string
    linearId: string
    teachId: string
}

export function agentPickerIds(scope: StoryScope): AgentPickerIds {
    return {
        projectId: scope.projectId,
        briefingId: scope.id("briefing"),
        writerId: scope.id("writer"),
        newsId: scope.id("news"),
        linearId: scope.id("linear"),
        teachId: scope.id("teach"),
    }
}

function agent(id: string, name: string, slug: string, description: string) {
    return {
        id,
        name,
        slug,
        description,
        flags: {is_agent: true, is_application: true},
        deleted_at: null,
        ...TIMESTAMPS,
    }
}

/**
 * The two query keys `agentWorkflowsListQueryStateAtom` unions — copied from the atoms that own
 * them (`workflow/state/store.ts`), which is the honest cost of cache-level seeding.
 *
 * The agent-flags key carries a version token built from the apps list, so the two have to be
 * seeded together and in agreement or the second query re-fetches against nothing.
 */
export function agentPickerQueries(scope: StoryScope, options: {empty?: boolean} = {}) {
    const ids = agentPickerIds(scope)
    const agents = options.empty
        ? []
        : [
              agent(
                  ids.briefingId,
                  "Daily Briefing Agent",
                  "daily-briefing",
                  "Morning digest of calendar, inbox and Linear",
              ),
              agent(
                  ids.writerId,
                  "technical-writer",
                  "technical-writer",
                  "Drafts and edits docs from a spec",
              ),
              agent(
                  ids.newsId,
                  "Hourly News Digest Agent",
                  "hourly-news",
                  "Scans sources hourly, posts to #news",
              ),
              agent(
                  ids.linearId,
                  "Linear issue agent builder",
                  "linear-issue-builder",
                  "Turns a Linear issue into a working agent",
              ),
              agent(ids.teachId, "Teach me", "teach-me", "Explains a codebase area on request"),
          ]

    const versionKey = agents.map((candidate) => [candidate.id, candidate.updated_at])

    const queries: [QueryKey, unknown][] = [
        [["workflows", "apps", "list", ids.projectId], {count: agents.length, refs: agents}],
        [["workflows", "evaluators", "list", ids.projectId], {count: 0, refs: []}],
        [
            ["workflows", "apps", "agentFlags", ids.projectId, versionKey],
            agents as unknown as Workflow[],
        ],
    ]
    return queries
}
