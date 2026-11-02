/**
 * Every user-facing string of agent sharing in the channel UI. Source: the approved M3 UI design
 * copy deck (section 5, "Channels"). The deck writes them for Slack; the platform is a
 * placeholder here, so for Slack each string is the deck's own. Placeholders are functions.
 */
import {joinNames} from "@agenta/entity-ui/sharing"

export const channelSharingCopy = {
    // Settings > Channels, the agent step.
    audienceNote: (project: string, platform: string) =>
        `For a shared agent, everyone in ${project} can read its ${platform} conversations in Agenta, including direct messages. For a private agent, new conversations are private to its owner.`,

    // The manage panel of a connection whose binding is off.
    connectionRow: (platform: string, place: string) => `${platform} · ${place}`,
    off: "Off",
    offIn: (places: readonly string[]) => `Off · in ${joinNames(places)}`,
    turnOn: "Turn on",
} as const
