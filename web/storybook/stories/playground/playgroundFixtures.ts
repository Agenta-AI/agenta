import {workflowFlagsSchema, type Workflow} from "@agenta/entities/workflow"
import type {QueryKey} from "@tanstack/react-query"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {variantNameCellQueries, workflowRevision, type WorkflowIds} from "../../fixtures/workflow"

/** A completion prompt app's revision: one system message, one user message with a variable. */
export const promptRevision = (ids: WorkflowIds): Workflow =>
    workflowRevision(ids, {
        slug: "capital-finder-v3",
        name: "default",
        version: 3,
        message: "Ask for the capital only",
        // Every flag false but is_application: a prompt app, not an agent.
        flags: workflowFlagsSchema.parse({is_application: true}),
        data: {
            uri: "agenta:builtin:completion:v0",
            parameters: {
                prompt: {
                    messages: [
                        {role: "system", content: "You answer with the capital city only."},
                        {role: "user", content: "What is the capital of {{country}}?"},
                    ],
                    llm_config: {model: "gpt-4o-mini", temperature: 0.2},
                },
            },
        },
    })

/** The query cache entries the config panel reads, with the revision deployed to production. */
export const promptRevisionQueries = (scope: StoryScope): [QueryKey, unknown][] =>
    variantNameCellQueries(scope, {
        revision: promptRevision,
        variantNames: ["default"],
        deployedTo: ["production"],
    })
