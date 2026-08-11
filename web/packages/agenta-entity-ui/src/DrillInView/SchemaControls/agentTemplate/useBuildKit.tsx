/**
 * useBuildKit — the playground-only "build kit" overlay shown in the Advanced section.
 *
 * The default agent config carries a server-side overlay of playground-only tools, skills, and
 * sandbox permissions that help the assistant build and revise the agent. None of it is part of the
 * published agent (the backend strips it on commit). This hook reads that overlay (keyed by the open
 * revision) plus the user's build-kit on/off toggle, and returns:
 *   - `hasBuildKitOverlay`: whether to render the build-kit block / extend the Advanced section,
 *   - `buildKitSection`: the read-only drawer block (platform tools, embedded tools/skills, sandbox
 *     permissions) with the enable/disable switch,
 *   - `permissionOverrideHint`: the inline warning to show above SandboxPermissionControl when the
 *     build kit overrides one of the user's permission values.
 *
 * Kept beside useModelHarness (which owns the Advanced section) so the overlay and the user's own
 * sandbox/permission controls render together.
 */
import {useMemo} from "react"

import {
    workflowAgentTemplateOverlayAtomFamily,
    workflowBuildKitEnabledAtomFamily,
} from "@agenta/entities/workflow"
import {Wrench} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"

import {BuildKitSection, PermissionOverrideHint} from "./BuildKitSection"
import {asObj, staticEmbedSlug, type ItemDescriptor} from "./itemDescriptors"

/** Display name for an `@ag.embed` row: the overlay's sibling `name`, else the referenced
 * workflow's `name`, else undefined (callers fall back to the slug). */
function embedDisplayName(entry: Record<string, unknown>): string | undefined {
    if (typeof entry.name === "string" && entry.name) return entry.name
    const refs = asObj(asObj(entry["@ag.embed"])?.["@ag.references"])
    const wfName = asObj(refs?.workflow)?.name ?? asObj(refs?.workflow_revision)?.name
    return typeof wfName === "string" && wfName ? wfName : undefined
}

function isEmbedRefEntry(entry: unknown): entry is Record<string, unknown> {
    return Boolean(
        entry && typeof entry === "object" && "@ag.embed" in (entry as Record<string, unknown>),
    )
}

function describeBuildKitPlatformTool(tool: Record<string, unknown>): ItemDescriptor {
    const op = typeof tool.op === "string" ? tool.op : "platform tool"
    return {
        name: op,
        description: "Platform-owned playground tool",
        mono: "",
        color: "#0d9488",
        icon: <Wrench size={15} weight="fill" />,
        tags: ["platform"],
        typeLabel: "platform",
        typeColor: "cyan",
        subtitle: "Platform tool",
    }
}

function describeBuildKitEmbed(
    entry: Record<string, unknown>,
    kind: "tool" | "skill",
): ItemDescriptor {
    const slug = staticEmbedSlug(entry)
    return {
        name: embedDisplayName(entry) ?? slug ?? `${kind} reference`,
        description: "Provided by Agenta. This item cannot be edited or removed.",
        mono: kind === "tool" ? "wf" : "sk",
        color: kind === "tool" ? "#0d9488" : "#6b7280",
        tags: ["@ag.embed"],
        typeLabel: "@ag.embed",
        typeColor: "blue",
        subtitle: "Agenta-owned reference",
    }
}

function stableString(value: unknown): string {
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

function overriddenPermissionKeys(
    userPermissions: Record<string, unknown> | null | undefined,
    overlayPermissions: Record<string, unknown> | null | undefined,
): string[] {
    if (!userPermissions || !overlayPermissions) return []
    return Object.entries(overlayPermissions)
        .filter(([key, overlayValue]) => {
            if (!(key in userPermissions)) return false
            return stableString(userPermissions[key]) !== stableString(overlayValue)
        })
        .map(([key]) => key)
}

export function useBuildKit({
    revisionId,
    sandboxPermissions,
    disabled,
    enabledOverride,
}: {
    revisionId: string | null
    sandboxPermissions: Record<string, unknown> | null
    disabled?: boolean
    /**
     * When set, the enable toggle reads/writes this buffer instead of the persisted atom — so a
     * section drawer can scope the change to its draft and commit it to the atom only on Save.
     */
    enabledOverride?: {value: boolean; onChange: (value: boolean) => void}
}) {
    const agentTemplateOverlay = useAtomValue(
        useMemo(() => workflowAgentTemplateOverlayAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const [atomBuildKitEnabled, setAtomBuildKitEnabled] = useAtom(
        useMemo(() => workflowBuildKitEnabledAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const buildKitEnabled = enabledOverride ? enabledOverride.value : atomBuildKitEnabled
    const setBuildKitEnabled = enabledOverride ? enabledOverride.onChange : setAtomBuildKitEnabled

    const overlayTools = useMemo(
        () => (Array.isArray(agentTemplateOverlay?.tools) ? agentTemplateOverlay.tools : []),
        [agentTemplateOverlay],
    )
    const overlaySkills = useMemo(
        () => (Array.isArray(agentTemplateOverlay?.skills) ? agentTemplateOverlay.skills : []),
        [agentTemplateOverlay],
    )
    const overlaySandbox = useMemo(
        () => asObj(agentTemplateOverlay?.sandbox),
        [agentTemplateOverlay],
    )
    const overlayPermissions = useMemo(() => asObj(overlaySandbox?.permissions), [overlaySandbox])
    const platformOverlayTools = useMemo(
        () =>
            overlayTools.filter((tool): tool is Record<string, unknown> =>
                Boolean(asObj(tool)?.type === "platform"),
            ),
        [overlayTools],
    )
    const embeddedOverlayTools = useMemo(() => overlayTools.filter(isEmbedRefEntry), [overlayTools])
    const embeddedOverlaySkills = useMemo(
        () => overlaySkills.filter(isEmbedRefEntry),
        [overlaySkills],
    )
    const hasBuildKitOverlay = Boolean(
        agentTemplateOverlay &&
        (platformOverlayTools.length > 0 ||
            embeddedOverlayTools.length > 0 ||
            embeddedOverlaySkills.length > 0 ||
            Object.keys(overlayPermissions ?? {}).length > 0),
    )
    const sandboxPermissionOverrideKeys = useMemo(
        () =>
            buildKitEnabled ? overriddenPermissionKeys(sandboxPermissions, overlayPermissions) : [],
        [buildKitEnabled, sandboxPermissions, overlayPermissions],
    )

    const buildKitSection = hasBuildKitOverlay ? (
        <BuildKitSection
            enabled={buildKitEnabled}
            onEnabledChange={setBuildKitEnabled}
            disabled={disabled}
            platformTools={platformOverlayTools.map(describeBuildKitPlatformTool)}
            embeddedTools={embeddedOverlayTools.map((tool) => describeBuildKitEmbed(tool, "tool"))}
            embeddedSkills={embeddedOverlaySkills.map((skill) =>
                describeBuildKitEmbed(skill, "skill"),
            )}
            permissions={overlayPermissions}
        />
    ) : null

    const permissionOverrideHint =
        sandboxPermissionOverrideKeys.length > 0 ? (
            <PermissionOverrideHint keys={sandboxPermissionOverrideKeys} />
        ) : null

    return {
        hasBuildKitOverlay,
        buildKitSection,
        permissionOverrideHint,
    }
}
