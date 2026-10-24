/**
 * Every user-facing string of agent sharing in the channel UI. Source: the approved M3 UI design
 * copy deck (section 5, "Channels"). The deck writes them for Slack; the platform is a
 * placeholder here, so for Slack each string is the deck's own. Placeholders are functions.
 */
import {joinNames} from "@agenta/entity-ui/sharing"

export const channelSharingCopy = {
    // Settings > Channels, the agent step.
    audienceNote: (project: string, platform: string) =>
        `Everyone in ${project} can read the agent's ${platform} conversations in Agenta, including direct messages.`,
    privateAgentRow: (platform: string) =>
        `Private. Share it with the project to use it in ${platform}.`,
    share: "Share",

    // The agent's own Publish panel, in place of the connect buttons.
    publishPrivate: (platforms: readonly string[]) =>
        `Private agents cannot answer in ${joinNames(platforms)}. Share this agent with the project to connect it.`,

    // The server refused the binding during setup.
    refusedPrivate: (platform: string) =>
        `This agent is private now, so it cannot answer in ${platform}.`,

    // The manage panel of a connection turned off by make-private.
    manageOffPrivate: (platform: string) =>
        `This agent is private, so its ${platform} connection is off.`,
    shareWithProject: "Share with project",
    connectionRow: (platform: string, place: string) => `${platform} · ${place}`,
    off: "Off",
    offIn: (places: readonly string[]) => `Off · in ${joinNames(places)}`,
    turnOn: "Turn on",
} as const
