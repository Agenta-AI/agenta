import type {ToolConnection} from "@agenta/entities/gatewayTool"
import type {Workflow} from "@agenta/entities/workflow"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {variantNameCellQueries, workflowIds, workflowRevision, type WorkflowIds} from "../workflow"

import {AGENT_SCHEMA, makeAgentConfigFixture} from "./index"

/** The viewer of the account stories. */
export const VIEWER = {id: "user-lena", email: "lena@example.com", username: "Lena"}

const zendesk = (slug: string, name: string, extra: Partial<ToolConnection> = {}) =>
    ({
        id: `conn-${slug}`,
        slug,
        name,
        provider_key: "composio",
        integration_key: "zendesk",
        flags: {is_active: true, is_valid: true},
        ...extra,
    }) as ToolConnection

const PROJECT_CONNECTIONS = [
    zendesk("acme-support", "acme-support"),
    zendesk("acme-eu-support", "acme-eu-support"),
]
const OWN_CONNECTIONS = [
    zendesk("lena-acme", "Lena at Acme", {is_default: true} as Partial<ToolConnection>),
    zendesk("lena-sandbox", "Lena sandbox"),
]

export interface AccountFrame {
    /** Each person's own (`user`) or one shared account (`agent`). */
    source: "user" | "agent"
    /** The viewer's own Zendesk accounts. */
    ownAccounts: boolean
    /** An automation of this agent saved with an API key. */
    apiKeyAutomation?: boolean
}

/** The agent "Support triage" with Zendesk set to the frame's account source. */
export function integrationAccountQueries(
    scope: StoryScope,
    frame: AccountFrame,
): [readonly unknown[], unknown][] {
    const fixture = makeAgentConfigFixture(scope)
    const ids = workflowIds(scope)
    const tools = [
        {
            type: "gateway_connection",
            connection: {
                provider: "composio",
                integration: "zendesk",
                ...(frame.source === "user"
                    ? {account_source: "user"}
                    : {slug: PROJECT_CONNECTIONS[0].slug}),
            },
            policy: {permissions: {default: "allow_reads", tools: {}}},
        },
    ]
    const agent = {...fixture.value, tools}
    const revision = (revisionIds: WorkflowIds): Workflow =>
        workflowRevision(revisionIds, {
            name: "Support triage",
            data: {
                uri: "agenta:builtin:agent:v0",
                parameters: {agent},
                schemas: {parameters: {type: "object", properties: {agent: AGENT_SCHEMA}}},
            },
        } as Partial<Workflow>)
    const own = frame.ownAccounts ? OWN_CONNECTIONS : []
    const subscriptions = frame.apiKeyAutomation
        ? [
              {
                  id: scope.id("sub"),
                  connection_id: "conn-zendesk-trigger",
                  data: {event_key: "zendesk_new_ticket"},
                  artifact_id: ids.workflowId,
                  principal: {kind: "api_key", id: scope.id("key")},
              },
          ]
        : []
    return [
        ...fixture.queries,
        [
            ["tools", "connections", scope.projectId],
            {connections: PROJECT_CONNECTIONS, count: PROJECT_CONNECTIONS.length},
        ],
        [["tools", "connections", "user", VIEWER.id, scope.projectId], own],
        // Read once: personal accounts are on for this viewer.
        [["vault", "personal-secrets", VIEWER.id, scope.projectId], []],
        [
            ["triggers", "subscriptions", scope.projectId],
            {subscriptions, count: subscriptions.length},
        ],
        [["triggers", "schedules", scope.projectId], {schedules: [], count: 0}],
        ...variantNameCellQueries(scope, {revision}),
    ]
}

export const integrationAccountRevisionId = (scope: StoryScope): string =>
    workflowIds(scope).revisionId
