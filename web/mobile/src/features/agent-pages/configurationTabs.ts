import type {ConfigTab} from "../agent-layout/agentPanelState"

/**
 * The tabs of the agent's Configuration page (`?view=configuration&tab=<tab>`): the right panel's
 * Configuration tabs without Channels, which is a page of its own.
 */
export type ConfigurationTab = Exclude<ConfigTab, "channels">
export const CONFIGURATION_TABS: readonly ConfigurationTab[] = ["agent", "automations", "access"]

export const isConfigurationTab = (value: unknown): value is ConfigurationTab =>
    CONFIGURATION_TABS.includes(value as ConfigurationTab)

/** The column of an agent page on a desktop: the title, the tab row and the content share its edge. */
export const AGENT_PAGE_COLUMN = "mx-auto box-border w-full max-w-content-lg px-6"
/** The page column of the Configuration page on a desktop: the tab row and the Agent tab share it. */
export const CONFIGURATION_PAGE_COLUMN = AGENT_PAGE_COLUMN
