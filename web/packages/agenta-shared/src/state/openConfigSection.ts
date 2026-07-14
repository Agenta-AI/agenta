import {atom} from "jotai"

/**
 * Cross-component request to open one of the agent config's section drawers (Model & harness, Advanced).
 * Set by a remote trigger (e.g. the chat's connect-a-model banner) and consumed by `AgentTemplateControl`,
 * which opens the named section drawer and clears this back to `null`.
 */
export type AgentConfigSection = "model-harness" | "advanced"

export const openAgentConfigSectionAtom = atom<AgentConfigSection | null>(null)
