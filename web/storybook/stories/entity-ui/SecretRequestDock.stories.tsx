import {SecretRequestDock} from "@agenta/entity-ui/clientTools"
import type {ClientToolMeta} from "@agenta/shared/clientTools"
import type {Meta, StoryObj} from "@storybook/nextjs"
import type {ToolUIPart} from "ai"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {variantNameCellQueries, workflowIds, workflowRevision} from "../../fixtures/workflow"

const metaFor = (settled = false): ClientToolMeta => ({
    toolCallId: "secret-call-story",
    toolName: "request_secret",
    renderKind: "secret",
    state: settled ? "output-available" : "input-available",
    input: {
        name: "GitHub token",
        env_var: "GITHUB_TOKEN",
        reason: "Authenticate the requested repository operation",
    },
    output: settled
        ? {
              status: "configured",
              secret: {slug: "github-token"},
              env_var: "GITHUB_TOKEN",
              revision_id: "revision-committed",
          }
        : undefined,
    settled,
    part: {} as ToolUIPart,
})

const queries = (scope: StoryScope, attached = false) => {
    const ids = workflowIds(scope)
    const revision = workflowRevision(ids, {
        data: {
            parameters: {
                agent: {
                    sandbox: {
                        kind: "local",
                        credentials: attached
                            ? [
                                  {
                                      secret: {slug: "github-token"},
                                      binding: {type: "env", name: "GITHUB_TOKEN"},
                                  },
                              ]
                            : [],
                    },
                },
            },
        },
    })
    return [
        ...variantNameCellQueries(scope, {revision: () => revision}),
        [
            ["workflows", "artifact", ids.workflowId, scope.projectId],
            {...revision, name: "Repository assistant"},
        ] as [unknown[], unknown],
        [["vault", "secrets", "story-user", scope.projectId], []] as [unknown[], unknown],
    ]
}

const storyParameters = (attached = false) => ({
    agenta: {
        queries: (scope: StoryScope) => queries(scope, attached),
        args: (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId}),
    },
})

const baseArgs = {
    meta: metaFor(),
    revisionId: "replaced-by-story-scope",
    canEditSecrets: true,
    onAdoptRevision: () => undefined,
    onOutput: () => undefined,
}

const meta = {
    title: "@agenta/entity-ui/Secret/SecretRequestDock",
    component: SecretRequestDock,
    parameters: {layout: "centered", ...storyParameters()},
} satisfies Meta<typeof SecretRequestDock>

export default meta
type Story = StoryObj<typeof meta>

/** Pending request before a secret has been attached. Configure opens the native shared drawer. */
export const Pending: Story = {args: baseArgs}

/** Reload recovery: the requested variable is already present, so Continue resumes without create. */
export const ReadyToContinue: Story = {
    args: baseArgs,
    parameters: storyParameters(true),
}

/** A malformed platform request stays bounded and cannot open the setup flow. */
export const Unavailable: Story = {
    args: {...baseArgs, meta: {...metaFor(), input: {name: "Incomplete request"}}},
}
