import type {Workflow} from "@agenta/entities/workflow"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {variantNameCellQueries, workflowIds, workflowRevision} from "../workflow"

import {AGENT_SCHEMA, makeAgentConfigFixture} from "./index"

/**
 * The secrets flow (F04 f3 to f10): "Support triage" with three secret attachments, one of them
 * naming a secret that is not in the project, the project's secrets, and the person's own.
 */
export const SECRETS_USER_ID = "user-secrets-story"

/** A saved revision id: the needs-setup check runs only for a real (UUID) revision. */
const revisionUuid = (scope: StoryScope) => {
    const hex = [...scope.key].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    return `00000000-0000-4000-8000-${hex.padStart(12, "0").slice(-12)}`
}

export const SECRET_ROWS = [
    {
        id: "secret-billing",
        type: "custom_secret",
        name: "billing-prod",
        slug: "billing-prod",
        format: "text",
        defaultEnvVar: "BILLING_API_KEY",
        hasKey: true,
    },
    {
        id: "secret-github-bot",
        type: "custom_secret",
        name: "github-bot",
        slug: "github-bot",
        format: "text",
        hasKey: true,
    },
]

const OWN_SECRETS = [
    {
        id: "secret-mine",
        kind: "custom_secret",
        type: "custom_secret",
        name: "my-github-token",
        slug: "my-github-token",
        format: "text",
        hasKey: true,
    },
]

export const CREDENTIALS = [
    {secret: {slug: "billing-prod"}, binding: {type: "env", name: "BILLING_API_KEY"}},
    {secret: {account_source: "user"}, binding: {type: "env", name: "GITHUB_TOKEN"}},
    {secret: {slug: "crm-token"}, binding: {type: "env", name: "CRM_TOKEN"}},
]

/** Two sandboxes, so Advanced lists Execution. */
const SCHEMA = {
    ...AGENT_SCHEMA,
    properties: {
        ...AGENT_SCHEMA.properties,
        runner: {
            type: "object",
            properties: {
                permissions: {
                    type: "object",
                    properties: {
                        default: {type: "string", enum: ["allow", "allow_reads", "ask", "deny"]},
                    },
                },
            },
        },
        sandbox: {
            title: "Sandbox",
            type: "object",
            properties: {kind: {type: "string", enum: ["local", "daytona"]}},
        },
    },
}

export function secretsRevisionId(scope: StoryScope): string {
    return revisionUuid(scope)
}

export function secretsQueries(
    scope: StoryScope,
    opts: {credentials?: unknown[]; projectSecrets?: unknown[]; ownSecrets?: unknown[]} = {},
): [readonly unknown[], unknown][] {
    const fixture = makeAgentConfigFixture(scope)
    const ids = {...workflowIds(scope), revisionId: revisionUuid(scope)}
    const agent = {
        ...fixture.value,
        sandbox: {kind: "daytona", credentials: opts.credentials ?? CREDENTIALS},
    }
    const revision = (): Workflow =>
        workflowRevision(ids, {
            name: "Support triage",
            data: {
                uri: "agenta:builtin:agent:v0",
                parameters: {agent},
                schemas: {parameters: {type: "object", properties: {agent: SCHEMA}}},
            },
        } as Partial<Workflow>)
    return [
        ...fixture.queries,
        // The revision keeps its own (UUID) id; the cell queries key on it.
        ...variantNameCellQueries(scope, {revision}),
        [
            ["vault", "secrets", SECRETS_USER_ID, scope.projectId],
            opts.projectSecrets ?? SECRET_ROWS,
        ],
        [
            ["vault", "personal-secrets", SECRETS_USER_ID, scope.projectId],
            opts.ownSecrets ?? OWN_SECRETS,
        ],
        [
            ["workflows", "requirements", scope.projectId, ids.revisionId],
            {
                count: 1,
                status: "needs_setup",
                requirements: [
                    {
                        key: "secret:crm-token",
                        kind: "secret",
                        label: "CRM_TOKEN",
                        reference: {slug: "crm-token"},
                        paths: ["agent.sandbox.credentials[2]"],
                        reason: "not_found",
                        blocks_run: true,
                    },
                ],
            },
        ],
        [
            ["agentaToolsAccess", scope.projectId],
            {
                get_current_session: "read",
                list_triggers: "read",
                check_skill_updates: "read",
                create_schedule: "write",
                apply_skill_update: "write",
            },
        ],
    ]
}

export const secretsSchema = SCHEMA
