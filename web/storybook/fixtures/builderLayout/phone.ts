import {AGENT_NAME, AGENTS_MD} from "./index"

/**
 * Phone shared contract (SC9) stories: the text of the phone frames M02, M08 and M11 for agent
 * "Support triage". Data only; the components come from `@agenta/ui/phone`.
 */

export {AGENT_NAME, AGENTS_MD}

/** M08: the integrations of the agent, with the account source line. */
export const PHONE_INTEGRATIONS = [{name: "Zendesk", line: "Each person's own account"}]

/** M11: the entries of "Add automation". */
export const PHONE_ADD_AUTOMATION = [
    {key: "app", label: "App trigger", description: "React to an event from a connected app"},
    {key: "schedule", label: "Scheduled trigger", description: "Run on a recurring schedule"},
    {key: "ai", label: "Create with AI", description: "Describe it and let AI set it up"},
] as const

/** M02: the agent rows of the sidebar sheet. */
export const PHONE_SIDEBAR_ROWS = ["Configuration", "Channels", "Analytics"] as const
