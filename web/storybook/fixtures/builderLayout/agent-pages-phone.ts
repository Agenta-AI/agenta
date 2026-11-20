/** M07 Configuration on a phone: the section rows with their current values (canvas text). */
export const M07_VERSION_LABEL = "Saved as v4"
export const M07_SECTIONS: {key: string; title: string; summary: string}[] = [
    {key: "model-harness", title: "Model", summary: "Claude Sonnet 5.5 · via Claude Code"},
    {key: "instructions", title: "Instructions", summary: "AGENTS.md · 33 words"},
    {key: "tools", title: "Integrations", summary: "Zendesk"},
    {key: "subagents", title: "Subagents", summary: "None"},
    {key: "mcp", title: "MCP servers", summary: "None"},
    {key: "skills", title: "Skills", summary: "ticket-triage, plain-writing"},
    {key: "secrets", title: "Secrets", summary: "BILLING_API_KEY, GITHUB_TOKEN"},
    {key: "permissions", title: "Permissions", summary: "Allow reads"},
    {key: "advanced", title: "Advanced", summary: "Sandbox: Daytona"},
]
