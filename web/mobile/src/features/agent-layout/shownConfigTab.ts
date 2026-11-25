import type {ConfigTab} from "./agentPanelState"

/** The tab on screen: a phone has no Channels tab, so a stored Channels shows Agent. */
export const shownConfigTab = (panel: {phone: boolean; configTab: ConfigTab}): ConfigTab =>
    panel.phone && panel.configTab === "channels" ? "agent" : panel.configTab
