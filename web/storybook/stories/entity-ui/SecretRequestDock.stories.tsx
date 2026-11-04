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

/** Nothing saved yet: the value goes straight into the card, with the variable beside it. */
export const Pending: Story = {args: baseArgs}

/** The requested variable is attached, so Continue resumes and Change value opens the field. */
export const ReadyToContinue: Story = {
    args: baseArgs,
    parameters: storyParameters(true),
}

/** The agent tried the saved value and it failed, so the card asks for a new one first. */
export const Rejected: Story = {
    args: {
        ...baseArgs,
        meta: {...metaFor(), input: {...metaFor().input, reason: "GitHub refused it", rejected: true}},
    },
    parameters: storyParameters(true),
}

/** Without edit permission there is no field, and the card says why. */
export const ReadOnly: Story = {args: {...baseArgs, canEditSecrets: false}}

/** A malformed platform request stays bounded and cannot open the setup flow. */
export const Unavailable: Story = {
    args: {...baseArgs, meta: {...metaFor(), input: {name: "Incomplete request"}}},
}
