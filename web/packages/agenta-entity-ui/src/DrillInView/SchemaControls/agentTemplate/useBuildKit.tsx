/**
 * useBuildKit — the playground-only "build kit" overlay shown in the Advanced section.
 *
 * The default agent config carries a server-side overlay of playground-only tools, skills, and
 * sandbox permissions that help the assistant build and revise the agent. None of it is part of the
 * published agent (the backend strips it on commit). This hook reads that overlay (keyed by the open
 * revision) plus the user's build-kit state — the master on/off and the platform ops switched off
 * individually — and returns:
 *   - `hasBuildKitOverlay`: whether to render the build-kit block / extend the Advanced section,
 *   - `buildKitSection`: the drawer block (one tool list — platform tools with a switch each, the
 *     Agenta-owned embeds locked on — plus sandbox permissions) under the master enable switch,
 *   - `permissionOverrideHint`: the inline warning to show above SandboxPermissionControl when the
 *     build kit overrides one of the user's permission values.
 *
 * Kept beside useModelHarness (which owns the Advanced section) so the overlay and the user's own
 * sandbox/permission controls render together.
 */
import {useMemo} from "react"

import {
    workflowAgentTemplateOverlayAtomFamily,
    workflowBuildKitDisabledOpsAtomFamily,
    workflowBuildKitEnabledAtomFamily,
    type BuildKitUiState,
} from "@agenta/entities/workflow"
import {useAtom, useAtomValue} from "jotai"

import {describeBuildKitEmbed, describeBuildKitPlatformTool} from "./buildKitDescriptors"
import {BuildKitSection, PermissionOverrideHint, type BuildKitTool} from "./BuildKitSection"
import {asObj, staticEmbedSlug} from "./itemDescriptors"

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

/** One always-on row for an `@ag.embed` overlay entry; `fallbackKey` covers an embed with no slug. */
function embedRow(entry: Record<string, unknown>, fallbackKey: string): BuildKitTool {
    const slug = staticEmbedSlug(entry)
    return {
        key: slug ?? fallbackKey,
        descriptor: describeBuildKitEmbed(slug, embedDisplayName(entry)),
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
    stateOverride,
}: {
    revisionId: string | null
    sandboxPermissions: Record<string, unknown> | null
    disabled?: boolean
    /** When set, the switches read/write this draft buffer instead of the persisted atoms. */
    stateOverride?: {value: BuildKitUiState; onChange: (next: BuildKitUiState) => void}
}) {
    const agentTemplateOverlay = useAtomValue(
        useMemo(() => workflowAgentTemplateOverlayAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const [atomBuildKitEnabled, setAtomBuildKitEnabled] = useAtom(
        useMemo(() => workflowBuildKitEnabledAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const [atomDisabledOps, setAtomDisabledOps] = useAtom(
        useMemo(() => workflowBuildKitDisabledOpsAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const buildKitEnabled = stateOverride ? stateOverride.value.enabled : atomBuildKitEnabled
    const disabledOps = stateOverride ? stateOverride.value.disabledOps : atomDisabledOps
    const write = (next: BuildKitUiState) => {
        if (stateOverride) stateOverride.onChange(next)
        else {
            setAtomBuildKitEnabled(next.enabled)
            setAtomDisabledOps(next.disabledOps)
        }
    }
    const setDisabledOps = (next: string[]) => write({enabled: buildKitEnabled, disabledOps: next})

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

    // Platform tools first, then the Agenta-owned embeds — one list, no category headings (#6025).
    const toolRows = useMemo<BuildKitTool[]>(
        () => [
            ...platformOverlayTools.map((tool) => {
                const op = typeof tool.op === "string" ? tool.op : "platform tool"
                return {
                    key: op,
                    descriptor: describeBuildKitPlatformTool(op),
                    toggle: {op, enabled: !disabledOps.includes(op)},
                }
            }),
            ...embeddedOverlayTools.map((tool, index) => embedRow(tool, `embed-tool-${index}`)),
            ...embeddedOverlaySkills.map((skill, index) => embedRow(skill, `embed-skill-${index}`)),
        ],
        [platformOverlayTools, disabledOps, embeddedOverlayTools, embeddedOverlaySkills],
    )
    const toggleTool = (op: string, next: boolean) =>
        setDisabledOps(next ? disabledOps.filter((entry) => entry !== op) : [...disabledOps, op])
    const setAllTools = (next: boolean) =>
        setDisabledOps(
            next ? [] : toolRows.flatMap((tool) => (tool.toggle ? [tool.toggle.op] : [])),
        )

    const buildKitSection = hasBuildKitOverlay ? (
        <BuildKitSection
            enabled={buildKitEnabled}
            onEnabledChange={(next) => write({enabled: next, disabledOps})}
            disabled={disabled}
            tools={toolRows}
            onToggleTool={toggleTool}
            onSetAllTools={setAllTools}
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
