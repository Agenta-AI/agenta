import {createContext} from "react"

/**
 * The agent's Configuration page shows the sections in three titled groups: what the agent runs
 * on, what it can use, and the rest. The panes keep one flat list, since they are narrow and the
 * tab already names the content.
 */
export const ConfigSectionGroupsContext = createContext(false)

export type ConfigSectionGroupKey = "setup" | "uses" | "more"

/** The group of each section key. A key not listed here joins "uses". */
const GROUP_OF_SECTION: Record<string, ConfigSectionGroupKey> = {
    "model-harness": "setup",
    instructions: "setup",
    tools: "uses",
    subagents: "uses",
    mcp: "uses",
    skills: "uses",
    secrets: "uses",
    permissions: "more",
    advanced: "more",
}

export const CONFIG_SECTION_GROUPS: readonly ConfigSectionGroupKey[] = ["setup", "uses", "more"]

export const groupOfSection = (key: string): ConfigSectionGroupKey =>
    GROUP_OF_SECTION[key] ?? "uses"
