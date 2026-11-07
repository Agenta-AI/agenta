/**
 * Every user-facing string of agent sharing in the channel UI. Source: the approved M3 UI design
 * copy deck (section 5, "Channels"). The deck writes them for Slack; the platform is a
 * placeholder here, so for Slack each string is the deck's own. Placeholders are functions.
 */
import {joinNames} from "@agenta/entity-ui/sharing"
import {createT} from "@agenta/i18n"
import channelsSharingCatalog from "@agenta/i18n/catalogs/channels.sharing"

const t = createT(channelsSharingCatalog)

export const channelSharingCopy = {
    // Settings > Channels, the agent step.
    audienceNote: (project: string, platform: string) =>
        t("channels.sharing.audienceNote", {project, platform}),

    // The manage panel of a connection whose binding is off.
    connectionRow: (platform: string, place: string) => `${platform} · ${place}`,
    // Getters: the text is read at render, in the current language.
    get off() {
        return t("channels.sharing.off")
    },
    offIn: (places: readonly string[]) => t("channels.sharing.offIn", {places: joinNames(places)}),
    get turnOn() {
        return t("channels.sharing.turnOn")
    },
} as const
