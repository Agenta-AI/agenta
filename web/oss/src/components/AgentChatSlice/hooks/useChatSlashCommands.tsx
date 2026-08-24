import {useCallback, useMemo, useState} from "react"

import {agentModelCandidatesAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {
    buildConnectionPickerRows,
    buildPickerGroupsWithSections,
    pickerSelectionFrom,
    describeMcp,
    describeSkill,
    describeTool,
    harnessMetaFor,
    modelDisplayName,
    permissionPolicyLabel,
    permissionPolicyOptionsForSchema,
    permissionPolicySchema,
    DEFAULT_PERMISSION_POLICY,
    PLATFORM_OPS,
    providerForModel,
    vaultPickedProviderFamily,
    readAgentItems,
    readHarnessKind,
    readModelId,
    readModelConnectionSlug,
    readRunnerPermission,
    staticEmbedSlug,
    toolName,
    withHarnessKind,
    withModel,
    withRunnerPermission,
    type ItemDescriptor,
    type PermissionPolicy,
} from "@agenta/entity-ui/drill-in"
import {parseGatewayTool} from "@agenta/entity-ui/tool-utils"
import {CLIENT_TOOL_NAMES} from "@agenta/shared/clientTools"
import {draftConfigChangeSignalAtom} from "@agenta/shared/state"
import type {SlashCommandSection} from "@agenta/ui/rich-chat-input"
// Same icons the config panel gives these sections (AgentTemplateControl / itemKinds).
import {ChatCircleDots, Cpu, GraduationCap, Plugs, ShieldCheck, Wrench} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {useOptionalOnboardingContext} from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingContext"

import {useChatScopeKey} from "../state/scope"
import {addSessionAtomFamily} from "../state/sessions"

/** Which picker the palette drilled into, or null when the palette is just a list. */
export type SlashPicker = "model" | "permissions" | null

/**
 * The `/` palette for the agent chat composer.
 *
 * `/model` drills into a picker whose apply writes the DRAFT agent config through
 * `updateConfiguration` — the same write-through `useAlwaysAllowTool` uses, so the change takes
 * effect on the next send with no commit. Tools and skills insert their slug as plain text: the
 * request carries text and file parts only, so an inserted name is a hint the agent usually
 * follows, never a dispatch. Nothing in the UI may claim otherwise.
 */
export function useChatSlashCommands({
    entityId,
    /** Onboarding runs on an uncommitted agent with a different Enter — no palette there. */
    suspended,
    /** Fires as a picker opens, so the host can hand it the keyboard. */
    onPickerOpen,
}: {
    entityId: string
    suspended?: boolean
    onPickerOpen?: () => void
}) {
    const config = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )
    const parametersSchema = useAtomValue(
        useMemo(() => workflowMolecule.selectors.parametersSchema(entityId), [entityId]),
    )
    const candidateState = useAtomValue(agentModelCandidatesAtomFamily(true))
    const capabilities = candidateState.capabilities
    const setConfiguration = useSetAtom(workflowMolecule.actions.updateConfiguration)
    const raiseDraftSignal = useSetAtom(draftConfigChangeSignalAtom)

    // `/new` is the palette's shortcut for the session rail's `+`, so it shares that button's
    // state and its one gate: onboarding holds you in the founding conversation until it settles.
    const scope = useChatScopeKey()
    const addSession = useSetAtom(addSessionAtomFamily(scope))
    const newSessionLocked = !!useOptionalOnboardingContext()?.newSessionLocked

    const [picker, setPicker] = useState<SlashPicker>(null)

    /**
     * Clear the command, then open the picker a frame later. Clearing schedules a Lexical
     * reconcile that re-asserts the editor's selection; if the picker is already up it has just
     * autofocused itself, reads that as focus leaving, and dismisses immediately.
     */
    const openPicker = useCallback(
        (which: Exclude<SlashPicker, null>) => {
            onPickerOpen?.()
            requestAnimationFrame(() => setPicker(which))
        },
        [onPickerOpen],
    )

    const currentModel = readModelId(config)
    // A vault-hosted model is only reachable THROUGH its named connection, so every
    // availability check needs the slug and the secrets, exactly as the drawer passes them.
    const currentConnectionSlug = readModelConnectionSlug(config)
    const currentHarness = readHarnessKind(config)
    const currentPermission = readRunnerPermission(config)
    const currentPermissionLabel =
        permissionPolicyLabel(currentPermission ?? DEFAULT_PERMISSION_POLICY) ?? "Allow reads"
    const currentModelLabel = modelDisplayName(capabilities, currentHarness, currentModel)

    /**
     * Policies this agent's schema permits, and whether it declares the field at all — the drawer
     * hides its control when it does not, so the palette must not offer a shortcut to it. A schema
     * that has not loaded yet is unknown, not absent: keep the command rather than flicker it away.
     */
    const permissionOptions = useMemo(
        () => permissionPolicyOptionsForSchema(parametersSchema),
        [parametersSchema],
    )
    const permissionsAvailable =
        (!parametersSchema || permissionPolicySchema(parametersSchema) !== null) &&
        permissionOptions.length > 0

    /**
     * The same model source the config drawer uses: one group per stored connection (and per
     * subscription), each listing its models crossed with the harnesses that may drive them.
     * Built from one recipe with `useModelHarness` so the two pickers cannot list different models
     * for the same agent.
     */
    const modelGroups = useMemo(() => {
        const rows =
            candidateState.status === "ready"
                ? buildConnectionPickerRows({
                      candidates: candidateState.candidates,
                      connections: candidateState.connections,
                      capabilities,
                  })
                : []
        return buildPickerGroupsWithSections(rows)
    }, [candidateState, capabilities])
    // With neither source the drawer falls back to a schema-driven picker, which this palette does
    // not host — so offer no `/model` at all rather than a command that opens an empty panel.
    const modelAvailable = modelGroups.length > 0

    const write = useCallback(
        (
            next: Record<string, unknown> | null,
            summary: string,
            // The config accordion's own keys, so the section the write landed in pulses for
            // attention while the user's eyes are still on the chat.
            sectionKeys: string[] = ["model-harness"],
        ) => {
            if (!next) return
            setConfiguration(entityId, next)
            raiseDraftSignal({
                revisionId: entityId,
                sectionKeys,
                origin: "slash-command",
                summary,
                at: Date.now(),
            })
        },
        [entityId, raiseDraftSignal, setConfiguration],
    )

    /**
     * Apply a picked model. A connection row's option carries its connection slug, mode, provider
     * family and harness in `metadata`. Read them off the PICKED option rather than re-deriving
     * from the model id — duplicate ids exist across providers/connections — and mirror the drawer's
     * provider rule: a vault pick resolves to the model FAMILY, since a connection's own kind
     * (bedrock/…) would fail the harness check.
     *
     * A row names a model AND the harness that runs it, so both are written in one patch chain.
     */
    const applyModel = useCallback(
        (modelId: string, option?: {metadata?: Record<string, unknown>}) => {
            const selection = pickerSelectionFrom(modelId, option?.metadata)
            const harness = selection.harness ?? currentHarness
            // A row naming a connection carries what to persist in its own metadata, but the two
            // sources spell it differently: a connection row the already-resolved family, the
            // fallback catalog menu the connection's raw KIND. Run a non-empty one through the
            // drawer's resolver (a deployment kind is never a valid provider); an EMPTY one is the
            // row saying the slug is the whole route (a custom OpenAI-compatible connection), so
            // never re-derive a family behind its back.
            const provider = selection.slug
                ? selection.provider
                    ? vaultPickedProviderFamily(modelId, selection.provider, capabilities, harness)
                    : null
                : (selection.provider ?? providerForModel(capabilities, harness, modelId))
            const label = modelDisplayName(capabilities, harness, modelId)
            const base =
                selection.harness && selection.harness !== currentHarness
                    ? (withHarnessKind(config, selection.harness) ?? config)
                    : config
            write(
                withModel(base, {
                    modelId,
                    provider,
                    mode: selection.mode,
                    slug: selection.slug,
                }),
                selection.harness && selection.harness !== currentHarness
                    ? `Model set to ${label} · ${harnessMetaFor(selection.harness).label}`
                    : `Model set to ${label}`,
            )
            setPicker(null)
        },
        [capabilities, config, currentHarness, write],
    )

    const applyPermission = useCallback(
        (policy: PermissionPolicy) => {
            const label = permissionPolicyLabel(policy) ?? policy
            // `advanced` is the panel key `runner.permissions.default` classifies under.
            write(withRunnerPermission(config, policy), `Permissions set to ${label}`, ["advanced"])
            setPicker(null)
        },
        [config, write],
    )

    const sections = useMemo<SlashCommandSection[]>(() => {
        if (suspended) return []
        const {tools, mcps, skills} = readAgentItems(config)

        /**
         * A palette row from a config item. The row is keyed on a TYPEABLE token, not the
         * descriptor's display name — a descriptor reads as prose ("Static skill"), and inserting
         * that would put text into the message that the palette could never match again. An item
         * with no token is dropped rather than shown as something you cannot type.
         */
        const row = (
            descriptor: ItemDescriptor,
            token: string | undefined,
            index: number,
            prefix: string,
        ) => {
            if (!token || /\s/.test(token)) return null
            return {
                key: `${prefix}-${token}-${index}`,
                label: `/${token}`,
                // The descriptor's prose name is worth showing when it differs from the token.
                description:
                    descriptor.description ??
                    (descriptor.name === token ? undefined : descriptor.name),
                tail: descriptor.tags[0],
                icon:
                    prefix === "skill" ? (
                        <GraduationCap size={14} />
                    ) : prefix === "mcp" ? (
                        <Plugs size={14} />
                    ) : (
                        <Wrench size={14} />
                    ),
                kind: "insert" as const,
            }
        }

        /**
         * A connected-app tool as `integration.action`. Its wire name is a long slug
         * (`tools__composio__gmail__GMAIL_SEND_EMAIL__conn1`) — unreadable in a message and painful
         * to type, and the inserted text is a hint for the model rather than a wire identifier.
         */
        const gatewayToken = (tool: unknown): string | undefined => {
            const parsed = parseGatewayTool(tool)
            if (!parsed) return undefined
            return `${parsed.integration}.${parsed.action.toLowerCase()}`
        }

        /** A config entry's own slug/name — what the backend matches, so what we insert. */
        const entryToken = (entry: unknown): string | undefined => {
            if (!entry || typeof entry !== "object") return undefined
            const record = entry as Record<string, unknown>
            for (const key of ["slug", "name"]) {
                const value = record[key]
                if (typeof value === "string" && value) return value
            }
            return undefined
        }

        const compact = <T,>(rows: (T | null)[]) =>
            rows.filter((entry): entry is T => entry !== null)

        /**
         * Tools and MCP servers are withheld from the palette for now. The rows are still built
         * below — hiding them is a display decision, not a retraction of the feature, so bringing
         * them back is flipping this one flag rather than rewriting the mapping.
         */
        const SHOW_TOOLS = false

        const commandItems = compact([
            modelAvailable
                ? {
                      key: "model",
                      label: "/model",
                      description: "Switch the model for this agent",
                      tail: currentModelLabel ? `${currentModelLabel} ›` : "›",
                      icon: <Cpu size={14} />,
                      kind: "open" as const,
                      onSelect: () => openPicker("model"),
                  }
                : null,
            permissionsAvailable
                ? {
                      key: "permissions",
                      label: "/permissions",
                      description: "Set what the agent may do before it must ask",
                      tail: `${currentPermissionLabel} ›`,
                      icon: <ShieldCheck size={14} />,
                      kind: "open" as const,
                      onSelect: () => openPicker("permissions"),
                  }
                : null,
            newSessionLocked
                ? null
                : {
                      key: "new",
                      label: "/new",
                      description: "Start a fresh session with this agent",
                      icon: <ChatCircleDots size={14} />,
                      kind: "action" as const,
                      onSelect: () => addSession(),
                  },
        ])

        /**
         * A skill's typeable slug. An `@ag.embed` entry keeps it under
         * `@ag.embed.@ag.references.workflow` (or `workflow_revision` when pinned), NOT at the top
         * level — `staticEmbedSlug` is the reader the config panel already uses for exactly that.
         * Inline skills carry a plain top-level slug, so they fall through to `entryToken`.
         */
        const skillToken = (skill: unknown): string | undefined => {
            const embedded = skill && typeof skill === "object"
            return (
                (embedded ? staticEmbedSlug(skill as Record<string, unknown>) : undefined) ??
                entryToken(skill)
            )
        }

        const skillItems = compact(
            skills.map((skill, i) => row(describeSkill(skill), skillToken(skill), i, "skill")),
        )
        /**
         * Platform ops (`commit_revision`, `list_connections`, schedules) and browser-fulfilled
         * client tools are runtime plumbing the agent drives itself — never something a user hints
         * at. Same sets that keep them off the approval card's auto-allow.
         */
        const isPlumbing = (tool: unknown, token: string | undefined) => {
            const type = (tool as Record<string, unknown> | null)?.type
            if (type === "platform") return true
            return !!token && (PLATFORM_OPS.has(token) || CLIENT_TOOL_NAMES.has(token))
        }

        const toolItems = compact([
            ...tools.map((tool, i) => {
                const token = gatewayToken(tool) ?? toolName(tool) ?? entryToken(tool)
                if (isPlumbing(tool, token)) return null
                return row(describeTool(tool), token, i, "tool")
            }),
            ...mcps.map((mcp, i) => row(describeMcp(mcp), entryToken(mcp), i, "mcp")),
        ])

        return [
            {key: "commands", title: "Commands", items: commandItems},
            {key: "skills", title: "Skills", items: skillItems},
            ...(SHOW_TOOLS ? [{key: "tools", title: "Tools", items: toolItems}] : []),
        ].filter((section) => section.items.length > 0)
    }, [
        config,
        currentHarness,
        currentModelLabel,
        currentPermissionLabel,
        modelAvailable,
        newSessionLocked,
        addSession,
        openPicker,
        permissionsAvailable,
        suspended,
    ])

    return {
        sections,
        picker,
        closePicker: useCallback(() => setPicker(null), []),
        modelGroups,
        currentModel,
        currentConnectionSlug,
        currentHarness,
        currentPermission,
        permissionOptions,
        capabilities,
        applyModel,
        applyPermission,
    }
}
