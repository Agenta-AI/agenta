import {useCallback, useMemo, useState} from "react"

import {harnessCapabilitiesAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {
    buildModelOptionGroups,
    describeMcp,
    describeSkill,
    describeTool,
    harnessAllowsModel,
    harnessMetaFor,
    modelLabel,
    permissionPolicyLabel,
    DEFAULT_PERMISSION_POLICY,
    CLIENT_TOOLS,
    PLATFORM_OPS,
    providerForModel,
    readAgentItems,
    readHarnessKind,
    readModelId,
    readRunnerPermission,
    selectableHarnesses,
    toolName,
    withHarnessKind,
    withModel,
    withRunnerPermission,
    type ItemDescriptor,
    type PermissionPolicy,
} from "@agenta/entity-ui/drill-in"
import {parseGatewayTool} from "@agenta/entity-ui/tool-utils"
import {draftConfigChangeSignalAtom} from "@agenta/shared/state"
import type {SlashCommandSection} from "@agenta/ui/rich-chat-input"
// Same icons the config panel gives these sections (AgentTemplateControl / itemKinds).
import {Cpu, Cube, GraduationCap, Plugs, ShieldCheck, Wrench} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

/** Which picker the palette drilled into, or null when the palette is just a list. */
export type SlashPicker = "model" | "harness" | "permissions" | null

/**
 * The `/` palette for the agent chat composer.
 *
 * `/model` and `/harness` drill into pickers whose apply writes the DRAFT agent config through
 * `updateConfiguration` — the same write-through `useAlwaysAllowTool` uses, so the change takes
 * effect on the next send with no commit. Tools and skills insert their slug as plain text: the
 * request carries text and file parts only, so an inserted name is a hint the agent usually
 * follows, never a dispatch. Nothing in the UI may claim otherwise.
 */
export function useChatSlashCommands({
    entityId,
    /** Onboarding runs on an uncommitted agent with a different Enter — no palette there. */
    suspended,
    /** Fires as a picker opens, so the host can clear the command that opened it. */
    onPickerOpen,
}: {
    entityId: string
    suspended?: boolean
    onPickerOpen?: () => void
}) {
    const config = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(""))
    const setConfiguration = useSetAtom(workflowMolecule.actions.updateConfiguration)
    const raiseDraftSignal = useSetAtom(draftConfigChangeSignalAtom)

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
    const currentHarness = readHarnessKind(config)
    const currentPermission = readRunnerPermission(config)
    const currentPermissionLabel =
        permissionPolicyLabel(currentPermission ?? DEFAULT_PERMISSION_POLICY) ?? "Allow reads"
    const currentModelLabel = modelLabel(capabilities, currentHarness, currentModel) ?? currentModel

    const modelGroups = useMemo(
        () => buildModelOptionGroups(capabilities, currentHarness),
        [capabilities, currentHarness],
    )

    const harnessIds = useMemo(
        () => selectableHarnesses(capabilities ? Object.keys(capabilities) : []),
        [capabilities],
    )

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

    const applyModel = useCallback(
        (modelId: string) => {
            const provider = providerForModel(capabilities, currentHarness, modelId)
            const label = modelLabel(capabilities, currentHarness, modelId) ?? modelId
            write(withModel(config, {modelId, provider}), `Model set to ${label}`)
            setPicker(null)
        },
        [capabilities, config, currentHarness, write],
    )

    /**
     * The model a harness falls back to when it cannot reach the current one: the first entry of
     * its first published provider group. The capability catalog publishes no explicit default, and
     * leaving an unreachable model behind (what the drawer does) reads as a silent failure in chat.
     */
    const fallbackModelFor = useCallback(
        (harness: string) => {
            const groups = buildModelOptionGroups(capabilities, harness)
            const first = groups[0]?.options[0]
            return first ? {id: first.value, label: first.label} : null
        },
        [capabilities],
    )

    const applyHarness = useCallback(
        (kind: string) => {
            const meta = harnessMetaFor(kind)
            const keepsModel = harnessAllowsModel(capabilities, kind, currentModel)
            const fallback = keepsModel ? null : fallbackModelFor(kind)
            const switched = withHarnessKind(config, kind)
            const next =
                fallback && switched
                    ? withModel(switched, {
                          modelId: fallback.id,
                          provider: providerForModel(capabilities, kind, fallback.id),
                      })
                    : switched
            // The panel already warned which model a stranded switch moves to, before applying.
            write(
                next,
                fallback
                    ? `Harness set to ${meta.label} · model moved to ${fallback.label}`
                    : `Harness set to ${meta.label}`,
            )
            setPicker(null)
        },
        [capabilities, config, currentModel, fallbackModelFor, write],
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

        const commandItems = [
            {
                key: "model",
                label: "/model",
                description: "Switch the model for this agent",
                tail: currentModelLabel ? `${currentModelLabel} ›` : "›",
                icon: <Cpu size={14} />,
                kind: "open" as const,
                onSelect: () => openPicker("model"),
            },
            {
                key: "harness",
                label: "/harness",
                description: "Switch the runtime that executes this agent",
                tail: currentHarness ? `${harnessMetaFor(currentHarness).label} ›` : "›",
                icon: <Cube size={14} />,
                kind: "open" as const,
                onSelect: () => openPicker("harness"),
            },
            {
                key: "permissions",
                label: "/permissions",
                description: "Set what the agent may do before it must ask",
                tail: `${currentPermissionLabel} ›`,
                icon: <ShieldCheck size={14} />,
                kind: "open" as const,
                onSelect: () => openPicker("permissions"),
            },
        ]

        const skillItems = compact(
            skills.map((skill, i) => row(describeSkill(skill), entryToken(skill), i, "skill")),
        )
        /**
         * Platform ops (`commit_revision`, `list_connections`, schedules) and browser-fulfilled
         * client tools are runtime plumbing the agent drives itself — never something a user hints
         * at. Same sets that keep them off the approval card's auto-allow.
         */
        const isPlumbing = (tool: unknown, token: string | undefined) => {
            const type = (tool as Record<string, unknown> | null)?.type
            if (type === "platform") return true
            return !!token && (PLATFORM_OPS.has(token) || CLIENT_TOOLS.has(token))
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
    }, [config, currentHarness, currentModelLabel, currentPermissionLabel, openPicker, suspended])

    return {
        sections,
        picker,
        closePicker: useCallback(() => setPicker(null), []),
        modelGroups,
        currentModel,
        currentHarness,
        currentPermission,
        harnessIds,
        capabilities,
        applyModel,
        applyHarness,
        applyPermission,
    }
}
