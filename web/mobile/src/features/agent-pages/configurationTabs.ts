/** The tabs of the agent's Configuration page (`?view=configuration&tab=<tab>`). */
export const CONFIGURATION_TABS = ["agent", "automations", "access"] as const
export type ConfigurationTab = (typeof CONFIGURATION_TABS)[number]

export const isConfigurationTab = (value: unknown): value is ConfigurationTab =>
    CONFIGURATION_TABS.includes(value as ConfigurationTab)
