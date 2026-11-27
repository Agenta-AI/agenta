/** M08 Integrations on a phone: the agent's integration entries (canvas: Zendesk, each person's own). */
export const M08_TOOLS: unknown[] = [
    {
        type: "gateway_connection",
        connection: {provider: "composio", integration: "zendesk", account_source: "user"},
        policy: {permissions: {default: "allow_reads", tools: {}}},
    },
]
