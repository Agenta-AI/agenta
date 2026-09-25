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
import {Wrench} from "@phosphor-icons/react"

import type {ItemDescriptor} from "./itemDescriptors"

interface BuildKitCopy {
    name: string
    description: string
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
const BUILD_KIT_TOOL_COPY: Record<string, BuildKitCopy> = {
    list_channel_destinations: {
        name: "List channels",
        description: "Lists the Slack channels and Telegram groups this agent's bots can reach.",
    },
    send_channel_message: {
        name: "Post to a channel",
        description: "Posts a message to a Slack channel or Telegram group.",
    },
    read_channel_messages: {
        name: "Read a channel",
        description: "Reads a channel's recent messages or one Slack thread.",
    },
    search_channel_messages: {
        name: "Search channels",
        description: "Searches the messages stored from this agent's channels.",
    },
    discover_tools: {
        name: "Find tools",
        description: "Searches Agenta's catalog for apps and actions this agent could use.",
    },
    read_config: {
        name: "Read the agent's setup",
        description: "Reads how this agent is configured right now.",
    },
    commit_revision: {
        name: "Save changes",
        description: "Saves an edit to this agent's setup as a new version.",
    },
    annotate_trace: {
        name: "Grade a run",
        description: "Records evaluation feedback on a run of this agent.",
    },
    query_spans: {
        name: "Look through runs",
        description: "Searches past runs to check what the agent actually did.",
    },
    test_run: {
        name: "Test the agent",
        description: "Runs this agent once against test messages and reports the result.",
    },
    get_current_session: {
        name: "Get the link to this chat",
        description: "Gets this chat's name and a link to open it in Agenta.",
    },
    check_skill_updates: {
        name: "Check skill updates",
        description: "Checks whether this agent's skills have newer versions.",
    },
    apply_skill_update: {
        name: "Apply a skill update",
        description: "Updates one of this agent's skills to its newer version.",
    },
    rename_session: {
        name: "Rename this chat",
        description: "Gives this chat a name and a recap so it is easy to find later.",
    },
    rename_agent: {
        name: "Rename the agent",
        description: "Gives this agent a name and a description.",
    },
    discover_triggers: {
        name: "Find triggers",
        description: "Searches connected apps for events that could run this agent.",
    },
    create_schedule: {
        name: "Add a schedule",
        description: "Sets this agent to run on a repeating schedule.",
    },
    create_subscription: {
        name: "Add a trigger",
        description: "Sets this agent to run when an event happens in a connected app.",
    },
    list_schedules: {
        name: "Check schedules",
        description: "Lists the schedules set up for this project.",
    },
    list_deliveries: {
        name: "Check trigger history",
        description: "Lists recent trigger runs and tests.",
    },
    test_subscription: {
        name: "Test a trigger",
        description: "Waits for one real event to confirm a trigger is wired up correctly.",
    },
    remove_schedule: {
        name: "Remove a schedule",
        description: "Deletes one of this agent's schedules.",
    },
    remove_subscription: {
        name: "Remove a trigger",
        description: "Deletes one of this agent's triggers.",
    },
}

/** Copy for the Agenta-owned tools and skills the kit embeds, keyed by the referenced slug. */
const BUILD_KIT_EMBED_COPY: Record<string, BuildKitCopy> = {
    __ag__request_connection: {
        name: "Ask you to connect an app",
        description: "Prompts you to connect an app when the agent needs access to one.",
    },
    __ag__request_input: {
        name: "Ask you a question",
        description: "Prompts you for details the agent needs before it can continue.",
    },
    __ag__request_secret: {
        name: "Ask you for a secret",
        description: "Prompts you to set up a credential the agent needs, never pasted in chat.",
    },
    __ag__build_an_agent: {
        name: "Guide to building agents",
        description: "Agenta's instructions for setting up and configuring an agent.",
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
    typeLabel: "playground tool",
    subtitle: "Playground-only tool",
})

/** Row for a `{type:"platform", op}` overlay tool. */
export function describeBuildKitPlatformTool(op: string): ItemDescriptor {
    return buildKitDescriptor(
        BUILD_KIT_TOOL_COPY[op] ?? {
            name: humanizeKey(op),
            description: "Playground-only tool provided by Agenta.",
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
        copy ?? {
            // A bare slug would put `__ag__future` on screen, which is the wire name again.
            name: name ?? (slug ? humanizeKey(slug) : "Playground tool"),
            description: "Playground-only tool provided by Agenta.",
        },
    )
}
