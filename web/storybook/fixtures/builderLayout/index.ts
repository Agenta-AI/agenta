import type {ToolCatalogIntegrationDetails, ToolConnection} from "@agenta/entities/gatewayTool"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {integrationQueries} from "../gatewayIntegration"

/**
 * The agent "Support triage" as the section values of canvas frame S02 (Configuration panel).
 * Milestones add their own fixtures in `builderLayout/<slug>.ts` and reuse this one.
 */

export const AGENT_NAME = "Support triage"

/** The model line of the Model section. */
export const MODEL_SUMMARY = "Claude Code · Claude Sonnet 5.5"

export const AGENTS_MD =
    "You are Support triage. You read each new support ticket, decide its urgency and category, label it in Zendesk, and draft a first reply in plain words. You never send a reply yourself."

/** Names of the two attached secrets. The agent value stores no secret names, so they are data only. */
export const SECRET_NAMES = ["ZENDESK_API_TOKEN", "ZENDESK_SUBDOMAIN"]

const ZENDESK_DETAIL: ToolCatalogIntegrationDetails = {
    key: "zendesk",
    name: "Zendesk",
    description: "Tickets, users and comments",
    logo: null,
    categories: ["Support"],
    auth_schemes: ["oauth"],
    actions_count: 2,
}

const ZENDESK_CONNECTION = {
    id: "conn-zendesk",
    slug: "zendesk",
    name: "Zendesk",
    provider_key: "composio",
    integration_key: "zendesk",
    flags: {is_active: true, is_valid: true},
} as ToolConnection

const HARNESS_CATALOG = {
    claude_code: {
        providers: ["anthropic"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "alias",
        models: {anthropic: ["claude-sonnet-5-5"]},
        mcp: {user_servers: {connection_types: ["http"], credentials: ["bearer"]}},
    },
}

export const AGENT_SCHEMA = {
    type: "object",
    "x-ag-type": "agent-template",
    title: "Agent",
    properties: {
        instructions: {
            title: "_InstructionsSchema",
            type: "object",
            properties: {agents_md: {type: "string"}},
        },
        llm: {title: "Model", type: "object"},
        harness: {
            title: "Harness",
            type: "object",
            properties: {
                kind: {
                    type: "string",
                    title: "Harness",
                    enum: ["claude_code"],
                    "x-ag-harness-ref": "harnesses",
                },
            },
        },
        tools: {title: "Tools", type: "array", items: {type: "object"}},
        mcps: {title: "MCPs", type: "array", items: {type: "object"}},
        skills: {title: "Skills", type: "array", items: {type: "object"}},
        sandbox: {
            title: "Sandbox",
            type: "object",
            properties: {kind: {type: "string", enum: ["local"]}},
        },
    },
}

export interface AgentConfigFixture {
    schema: typeof AGENT_SCHEMA
    value: Record<string, unknown>
    secretNames: string[]
    /** Query cache entries for `parameters.agenta.queries`. */
    queries: [readonly unknown[], unknown][]
}

export function makeAgentConfigFixture(scope: StoryScope): AgentConfigFixture {
    const integration = integrationQueries(scope, {
        connections: [ZENDESK_CONNECTION],
        catalogIntegrations: [ZENDESK_DETAIL],
    }).filter(([key]) => !(key[0] === "tools" && key[2] === "integrationDetail"))
    return {
        schema: AGENT_SCHEMA,
        secretNames: SECRET_NAMES,
        value: {
            instructions: {agents_md: AGENTS_MD},
            llm: {
                model: "claude-sonnet-5-5",
                provider: "anthropic",
                connection: {mode: "agenta"},
            },
            harness: {kind: "claude_code"},
            tools: [
                {
                    type: "gateway_connection",
                    connection: {
                        provider: "composio",
                        integration: "zendesk",
                        slug: ZENDESK_CONNECTION.slug ?? "",
                    },
                    policy: {permissions: {default: "allow", tools: {}}},
                },
            ],
            mcps: [],
            skills: [
                {
                    name: "ticket-labels",
                    description: "Label a ticket by urgency and category",
                    body: "...",
                },
                {
                    name: "reply-drafts",
                    description: "Draft a first reply in plain words",
                    body: "...",
                },
            ],
            runner: {permissions: {default: "allow_reads"}},
            sandbox: {kind: "local"},
        },
        queries: [
            [["workflows", "catalog", "harnesses"], HARNESS_CATALOG],
            [["mcp-endpoints", undefined, scope.projectId], []],
            [
                ["tools", "catalog", "integrationDetail", "composio", "zendesk"],
                {integration: ZENDESK_DETAIL},
            ],
            ...integration,
        ],
    }
}
