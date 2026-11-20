import type {Workflow} from "@agenta/entities/workflow"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {GITHUB_DETAIL, integrationQueries} from "../gatewayIntegration"
import {variantNameCellQueries, workflowIds, workflowRevision, type WorkflowIds} from "../workflow"

import {AGENT_SCHEMA, makeAgentConfigFixture} from "./index"

/**
 * The first configuration slice: the agent "Support triage" as a saved revision, so the views
 * read and write it through the workflow draft as in the app.
 */
export function configSliceQueries(scope: StoryScope): [readonly unknown[], unknown][] {
    const fixture = makeAgentConfigFixture(scope)
    const revision = (ids: WorkflowIds): Workflow =>
        workflowRevision(ids, {
            name: "Support triage",
            data: {
                uri: "agenta:builtin:agent:v0",
                parameters: {agent: fixture.value},
                schemas: {parameters: {type: "object", properties: {agent: AGENT_SCHEMA}}},
            },
        } as Partial<Workflow>)
    return [
        ...fixture.queries,
        // GitHub: in "All apps", so Connect has an app to connect.
        ...integrationQueries(scope, {connections: [GITHUB_WORK]}).filter(
            ([key]) => key[0] === "tools" && key[2] === "integrationDetail" && key[4] === "github",
        ),
        [
            ["tools", "catalog", "integrationDetail", "composio", "github"],
            {integration: GITHUB_DETAIL},
        ],
        ...variantNameCellQueries(scope, {revision}),
    ]
}

export const configSliceRevisionId = (scope: StoryScope): string => workflowIds(scope).revisionId
