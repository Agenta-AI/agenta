import type {ConfigTab} from "../agent-layout/agentPanelState"

/**
 * The tabs of the agent's Configuration page (`?view=configuration&tab=<tab>`): the right panel's
 * Configuration tabs without Channels, which is a page of its own.
 */
export type ConfigurationTab = Exclude<ConfigTab, "channels">
export const CONFIGURATION_TABS: readonly ConfigurationTab[] = ["agent", "automations", "access"]

export const isConfigurationTab = (value: unknown): value is ConfigurationTab =>
    CONFIGURATION_TABS.includes(value as ConfigurationTab)
