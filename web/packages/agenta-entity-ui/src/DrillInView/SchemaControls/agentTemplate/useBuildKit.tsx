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
import {useMemo, useState} from "react"

import {
    workflowAgentTemplateOverlayAtomFamily,
    workflowBuildKitEnabledAtomFamily,
} from "@agenta/entities/workflow"
import {cn} from "@agenta/ui/styles"
import {CaretRight, Warning, Wrench} from "@phosphor-icons/react"
import {Switch, Tag, Tooltip, Typography} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {asObj, staticEmbedSlug, type ItemDescriptor} from "./itemDescriptors"
import {ItemAvatar} from "./ItemRow"

/** Display name for an `@ag.embed` row: the overlay's sibling `name`, else the referenced
 * workflow's `name`, else undefined (callers fall back to the slug). */
function embedDisplayName(entry: Record<string, unknown>): string | undefined {
    if (typeof entry.name === "string" && entry.name) return entry.name
    const refs = asObj(asObj(entry["@ag.embed"])?.["@ag.references"])
    const wfName = asObj(refs?.workflow)?.name ?? asObj(refs?.workflow_revision)?.name
    return typeof wfName === "string" && wfName ? wfName : undefined
}

function ReadOnlyItemRow({descriptor}: {descriptor: ItemDescriptor}) {
    return (
        <div className="flex items-center gap-2.5 rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] bg-[var(--ant-color-fill-quaternary)] px-3 py-2 opacity-70">
            <ItemAvatar descriptor={descriptor} />
            <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs font-medium">{descriptor.name}</div>
                {descriptor.description ? (
                    <Typography.Text
                        type="secondary"
                        className="block truncate text-xs leading-tight"
                    >
                        {descriptor.description}
                    </Typography.Text>
                ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
                {descriptor.tags.map((tag) => (
                    <Tag key={tag} className="m-0 text-[11px]">
                        {tag}
                    </Tag>
                ))}
                <Tag className="m-0 text-[11px]">Locked</Tag>
            </div>
        </div>
    )
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

function formatPermissionValue(value: unknown): string {
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    if (value == null) return "null"
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
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
}: {
    revisionId: string | null
    sandboxPermissions: Record<string, unknown> | null
    disabled?: boolean
}) {
    const agentTemplateOverlay = useAtomValue(
        useMemo(() => workflowAgentTemplateOverlayAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const [buildKitEnabled, setBuildKitEnabled] = useAtom(
        useMemo(() => workflowBuildKitEnabledAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const [buildKitExpanded, setBuildKitExpanded] = useState(false)

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
        <div className="rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] bg-[#fcfcfa]">
            <button
                type="button"
                aria-expanded={buildKitExpanded}
                onClick={() => setBuildKitExpanded((open) => !open)}
                className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2.5 text-left"
            >
                <Wrench size={15} className="text-[var(--ag-c-586673,#586673)]" />
                <span className="text-[13px] font-medium">Playground build kit</span>
                <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-[var(--ag-c-586673,#586673)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#d97706]" />
                    Removed on commit
                </span>
                <span onClick={(e) => e.stopPropagation()} className="inline-flex items-center">
                    <Switch
                        size="small"
                        checked={buildKitEnabled}
                        onChange={setBuildKitEnabled}
                        disabled={disabled}
                    />
                </span>
                <CaretRight
                    size={14}
                    className={cn(
                        "text-[var(--ag-c-97A4B0,#97a4b0)] transition-transform",
                        buildKitExpanded && "rotate-90",
                    )}
                />
            </button>
            {buildKitExpanded ? (
                <div className="flex flex-col gap-3 border-0 border-t border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-3 pb-3 pt-2.5">
                    <p className="m-0 text-[11.5px] leading-snug text-[var(--ag-c-586673,#586673)]">
                        These playground-only tools, skills, and permissions help the assistant
                        build and revise this agent. None of this is part of the published agent.
                    </p>
                    {!buildKitEnabled ? (
                        <div className="rounded border border-solid border-[var(--ant-color-info-border)] bg-[var(--ant-color-info-bg)] px-2.5 py-2 text-[11.5px] leading-snug text-[var(--ant-color-info-text)]">
                            The assistant can no longer create files, run code, or edit the agent
                            here.
                        </div>
                    ) : null}
                    {platformOverlayTools.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                            <Typography.Text className="text-xs font-medium">
                                Platform tools
                            </Typography.Text>
                            {platformOverlayTools.map((tool, index) => (
                                <ReadOnlyItemRow
                                    key={`build-kit-platform-tool-${index}`}
                                    descriptor={describeBuildKitPlatformTool(tool)}
                                />
                            ))}
                        </div>
                    ) : null}
                    {embeddedOverlayTools.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                            <Typography.Text className="text-xs font-medium">
                                Embedded tools
                            </Typography.Text>
                            {embeddedOverlayTools.map((tool, index) => (
                                <ReadOnlyItemRow
                                    key={`build-kit-embedded-tool-${index}`}
                                    descriptor={describeBuildKitEmbed(tool, "tool")}
                                />
                            ))}
                        </div>
                    ) : null}
                    {embeddedOverlaySkills.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                            <Typography.Text className="text-xs font-medium">
                                Embedded skills
                            </Typography.Text>
                            {embeddedOverlaySkills.map((skill, index) => (
                                <ReadOnlyItemRow
                                    key={`build-kit-embedded-skill-${index}`}
                                    descriptor={describeBuildKitEmbed(skill, "skill")}
                                />
                            ))}
                        </div>
                    ) : null}
                    {overlayPermissions && Object.keys(overlayPermissions).length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                            <Typography.Text className="text-xs font-medium">
                                Sandbox permissions
                            </Typography.Text>
                            <div className="flex flex-col gap-1.5 opacity-70">
                                {Object.entries(overlayPermissions).map(([key, value]) => (
                                    <div
                                        key={key}
                                        className="flex items-center justify-between gap-3 rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] bg-[var(--ant-color-fill-quaternary)] px-3 py-2 text-xs"
                                    >
                                        <span className="font-mono">{key}</span>
                                        <Tag className="m-0 font-mono text-[11px]">
                                            {formatPermissionValue(value)}
                                        </Tag>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    ) : null

    const permissionOverrideHint =
        sandboxPermissionOverrideKeys.length > 0 ? (
            <Tooltip title="This value is overridden by the build kit in playground. Turn the build kit off to match the published agent.">
                <div className="inline-flex w-fit items-center gap-1.5 rounded bg-[var(--ant-color-warning-bg)] px-2 py-1 text-[11px] text-[var(--ant-color-warning-text)]">
                    <Warning size={12} />
                    Build kit overrides {sandboxPermissionOverrideKeys.join(", ")}
                </div>
            </Tooltip>
        ) : null

    return {
        hasBuildKitOverlay,
        buildKitSection,
        permissionOverrideHint,
    }
}
