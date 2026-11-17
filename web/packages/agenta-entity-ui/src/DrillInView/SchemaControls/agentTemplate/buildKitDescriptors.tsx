/**
 * Build-kit presentation: the user-facing copy for every row of the playground build kit, and the
 * `describe*` classifiers that turn an overlay entry into an {@link ItemDescriptor}.
 *
 * The overlay is model-facing config — a platform tool arrives as `{type:"platform", op}` and an
 * embed as an `@ag.embed` reference — so the wire carries no readable name or description and this
 * table supplies both. Wording follows the chat skin's platform glossary (`PLATFORM_TERMS` in
 * @agenta/chat) so a tool reads the same in this list as it does in the transcript: a revision is
 * "changes", a span is a "run", a subscription is a "trigger", a session is "this chat".
 *
 * Kept beside itemDescriptors.tsx for the same reason: the table and the classifiers that read it
 * live together.
 */
import {createT, type CatalogKey} from "@agenta/i18n"
import buildKitCatalog from "@agenta/i18n/catalogs/entityUi.buildKit"
import {Wrench} from "@phosphor-icons/react"

import type {ItemDescriptor} from "./itemDescriptors"

const t = createT(buildKitCatalog)

type BuildKitKey = CatalogKey<typeof buildKitCatalog>

interface BuildKitCopy {
    name: string
    description: string
}

interface BuildKitCopyKeys {
    name: BuildKitKey
    description: BuildKitKey
}

/** The reserved prefix on an Agenta-owned embed slug, dropped before the slug is read out. */
const AGENTA_SLUG_PREFIX = "__ag__"

/** Sentence-case a `verb_noun` key: `pause_schedule` -> "Pause schedule". Deliberately not
 * `humanizeActionKey`, which is for provider action keys and carries their acronym table. */
function humanizeKey(key: string): string {
    const words = key
        .replace(AGENTA_SLUG_PREFIX, "")
        .split(/[_\s]+/)
        .filter(Boolean)
    if (words.length === 0) return key
    return [words[0][0].toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ")
}

/** Copy for the ops the build kit ships. A missing op falls back to a humanized `op`. */
const BUILD_KIT_TOOL_COPY: Record<string, BuildKitCopyKeys> = {
    list_channel_destinations: {
        name: "entityUi.buildKit.listChannelDestinationsName",
        description: "entityUi.buildKit.listChannelDestinationsDescription",
    },
    send_channel_message: {
        name: "entityUi.buildKit.sendChannelMessageName",
        description: "entityUi.buildKit.sendChannelMessageDescription",
    },
    read_channel_messages: {
        name: "entityUi.buildKit.readChannelMessagesName",
        description: "entityUi.buildKit.readChannelMessagesDescription",
    },
    search_channel_messages: {
        name: "entityUi.buildKit.searchChannelMessagesName",
        description: "entityUi.buildKit.searchChannelMessagesDescription",
    },
    discover_tools: {
        name: "entityUi.buildKit.discoverToolsName",
        description: "entityUi.buildKit.discoverToolsDescription",
    },
    read_config: {
        name: "entityUi.buildKit.readConfigName",
        description: "entityUi.buildKit.readConfigDescription",
    },
    commit_revision: {
        name: "entityUi.buildKit.commitRevisionName",
        description: "entityUi.buildKit.commitRevisionDescription",
    },
    annotate_trace: {
        name: "entityUi.buildKit.annotateTraceName",
        description: "entityUi.buildKit.annotateTraceDescription",
    },
    query_spans: {
        name: "entityUi.buildKit.querySpansName",
        description: "entityUi.buildKit.querySpansDescription",
    },
    test_run: {
        name: "entityUi.buildKit.testRunName",
        description: "entityUi.buildKit.testRunDescription",
    },
    rename_session: {
        name: "entityUi.buildKit.renameSessionName",
        description: "entityUi.buildKit.renameSessionDescription",
    },
    rename_agent: {
        name: "entityUi.buildKit.renameAgentName",
        description: "entityUi.buildKit.renameAgentDescription",
    },
    discover_triggers: {
        name: "entityUi.buildKit.discoverTriggersName",
        description: "entityUi.buildKit.discoverTriggersDescription",
    },
    create_schedule: {
        name: "entityUi.buildKit.createScheduleName",
        description: "entityUi.buildKit.createScheduleDescription",
    },
    create_subscription: {
        name: "entityUi.buildKit.createSubscriptionName",
        description: "entityUi.buildKit.createSubscriptionDescription",
    },
    list_schedules: {
        name: "entityUi.buildKit.listSchedulesName",
        description: "entityUi.buildKit.listSchedulesDescription",
    },
    list_deliveries: {
        name: "entityUi.buildKit.listDeliveriesName",
        description: "entityUi.buildKit.listDeliveriesDescription",
    },
    test_subscription: {
        name: "entityUi.buildKit.testSubscriptionName",
        description: "entityUi.buildKit.testSubscriptionDescription",
    },
    remove_schedule: {
        name: "entityUi.buildKit.removeScheduleName",
        description: "entityUi.buildKit.removeScheduleDescription",
    },
    remove_subscription: {
        name: "entityUi.buildKit.removeSubscriptionName",
        description: "entityUi.buildKit.removeSubscriptionDescription",
    },
    list_agents: {
        name: "List agents",
        description: "Lists the agents in this project.",
    },
    read_agent_config: {
        name: "Read another agent's setup",
        description: "Reads how another agent in this project is configured.",
    },
    create_agent: {
        name: "Create an agent",
        description: "Creates a new agent in this project from the default setup.",
    },
    edit_agent_config: {
        name: "Save changes to another agent",
        description: "Saves an edit to another agent's setup as a new version. It is not deployed.",
    },
}

/** Copy for the Agenta-owned tools and skills the kit embeds, keyed by the referenced slug. */
const BUILD_KIT_EMBED_COPY: Record<string, BuildKitCopyKeys> = {
    __ag__request_connection: {
        name: "entityUi.buildKit.requestConnectionName",
        description: "entityUi.buildKit.requestConnectionDescription",
    },
    __ag__request_input: {
        name: "entityUi.buildKit.requestInputName",
        description: "entityUi.buildKit.requestInputDescription",
    },
    __ag__request_secret: {
        name: "entityUi.buildKit.requestSecretName",
        description: "entityUi.buildKit.requestSecretDescription",
    },
    __ag__build_an_agent: {
        name: "entityUi.buildKit.buildAnAgentName",
        description: "entityUi.buildKit.buildAnAgentDescription",
    },
}

/** Every build-kit row wears the same chrome: one list, one kind of thing. */
const buildKitDescriptor = ({name, description}: BuildKitCopy): ItemDescriptor => ({
    name,
    // Prose, never monospace: these are sentences about what a tool does, not identifiers.
    monoName: false,
    description,
    mono: "",
    color: "#0d9488",
    icon: <Wrench size={15} weight="fill" />,
    // No type tag: "platform" and "@ag.embed" are internal vocabulary (#6025).
    tags: [],
    typeLabel: t("entityUi.buildKit.playgroundToolType"),
    subtitle: t("entityUi.buildKit.playgroundOnlyTool"),
})

/** Reads a copy entry in the active language. */
const copyText = ({name, description}: BuildKitCopyKeys): BuildKitCopy => ({
    name: t(name),
    description: t(description),
})

/** Row for a `{type:"platform", op}` overlay tool. */
export function describeBuildKitPlatformTool(op: string): ItemDescriptor {
    const copy = BUILD_KIT_TOOL_COPY[op]
    return buildKitDescriptor(
        copy
            ? copyText(copy)
            : {
                  name: humanizeKey(op),
                  description: t("entityUi.buildKit.playgroundOnlyToolByAgenta"),
              },
    )
}

/** Row for an `@ag.embed` overlay tool or skill. `slug` and `name` come off the wire; the copy
 * table wins so every row is worded the same way. */
export function describeBuildKitEmbed(
    slug: string | undefined,
    name: string | undefined,
): ItemDescriptor {
    const copy = slug ? BUILD_KIT_EMBED_COPY[slug] : undefined
    return buildKitDescriptor(
        copy
            ? copyText(copy)
            : {
                  // A bare slug would put `__ag__future` on screen, which is the wire name again.
                  name: name ?? (slug ? humanizeKey(slug) : t("entityUi.buildKit.playgroundTool")),
                  description: t("entityUi.buildKit.playgroundOnlyToolByAgenta"),
              },
    )
}
