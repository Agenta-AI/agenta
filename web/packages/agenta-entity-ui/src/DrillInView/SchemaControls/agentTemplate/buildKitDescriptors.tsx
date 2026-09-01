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

import {humanizeActionKey, type ItemDescriptor} from "./itemDescriptors"

interface BuildKitCopy {
    name: string
    description: string
}

/** Copy for the platform ops the build kit ships (`build_kit.py`'s `DEFAULT_BUILD_KIT_OPS`). An op
 * missing from here still renders — it falls back to a humanized `op` — so adding one server-side
 * costs plain wording, not a broken row. */
const BUILD_KIT_TOOL_COPY: Record<string, BuildKitCopy> = {
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
    // No type tag: "platform" and "@ag.embed" are internal vocabulary (#6025). A row that cannot
    // be switched off says so with ItemRow's "Locked" tag instead.
    tags: [],
    typeLabel: "playground tool",
    subtitle: "Playground-only tool",
})

/** Row for a `{type:"platform", op}` overlay tool. */
export function describeBuildKitPlatformTool(op: string): ItemDescriptor {
    return buildKitDescriptor(
        BUILD_KIT_TOOL_COPY[op] ?? {
            name: humanizeActionKey(op),
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
            name: name ?? slug ?? "Playground tool",
            description: "Playground-only tool provided by Agenta.",
        },
    )
}
