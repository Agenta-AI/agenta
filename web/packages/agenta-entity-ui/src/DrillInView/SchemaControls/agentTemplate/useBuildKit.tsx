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
 *
 * Each tool/skill also carries its own switch: every entry costs model context on every turn, so a
 * user who never uses (say) the schedule ops can drop them. Disabled ids are filtered out of the
 * overlay before it is merged into the run parameters (`withBuildKitOverlay`), so they never reach
 * the wire. The preference is global and persisted — see `buildKitItems.ts`.
 */
import {useCallback, useMemo} from "react"

import {
    buildKitDisabledItemsAtom,
    buildKitSkillId,
    buildKitToolId,
    workflowAgentTemplateOverlayAtomFamily,
    workflowBuildKitEnabledAtomFamily,
} from "@agenta/entities/workflow"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {Warning, Wrench} from "@phosphor-icons/react"
import {Button, Switch, Tag, Tooltip, Typography} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {RailField} from "../../../drawers/shared/RailField"

import {asObj, staticEmbedSlug, type ItemDescriptor} from "./itemDescriptors"
import {ItemRow} from "./ItemRow"

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
    enabledOverride,
    disabledItemsOverride,
}: {
    revisionId: string | null
    sandboxPermissions: Record<string, unknown> | null
    disabled?: boolean
    /**
     * When set, the enable toggle reads/writes this buffer instead of the persisted atom — so a
     * section drawer can scope the change to its draft and commit it to the atom only on Save.
     */
    enabledOverride?: {value: boolean; onChange: (value: boolean) => void}
    /** Same draft-buffer contract as `enabledOverride`, for the per-item switches. */
    disabledItemsOverride?: {value: string[]; onChange: (value: string[]) => void}
}) {
    const agentTemplateOverlay = useAtomValue(
        useMemo(() => workflowAgentTemplateOverlayAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const [atomBuildKitEnabled, setAtomBuildKitEnabled] = useAtom(
        useMemo(() => workflowBuildKitEnabledAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const buildKitEnabled = enabledOverride ? enabledOverride.value : atomBuildKitEnabled
    const setBuildKitEnabled = enabledOverride ? enabledOverride.onChange : setAtomBuildKitEnabled
    const [atomDisabledItems, setAtomDisabledItems] = useAtom(buildKitDisabledItemsAtom)
    const disabledItems = disabledItemsOverride ? disabledItemsOverride.value : atomDisabledItems
    const setDisabledItems = disabledItemsOverride
        ? disabledItemsOverride.onChange
        : setAtomDisabledItems
    const disabledSet = useMemo(() => new Set(disabledItems), [disabledItems])
    const setItemEnabled = useCallback(
        (id: string, enabled: boolean) => {
            const next = disabledItems.filter((entry) => entry !== id)
            setDisabledItems(enabled ? next : [...next, id])
        },
        [disabledItems, setDisabledItems],
    )

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

    // Switches are inert while the whole kit is off — nothing is sent either way — but the per-item
    // choices are kept, so flipping the kit back on restores exactly what was on before.
    const togglesDisabled = Boolean(disabled) || !buildKitEnabled
    /** Rail label with the enabled count and (only when something is off) an Enable all action. */
    const railLabel = useCallback(
        (label: string, ids: (string | undefined)[]) => {
            const scoped = ids.filter((id): id is string => Boolean(id))
            const offCount = scoped.filter((id) => disabledSet.has(id)).length
            return (
                <div className="flex flex-col items-start gap-0.5">
                    <span>{label}</span>
                    <Typography.Text type="secondary" className="text-[11px] leading-snug">
                        {scoped.length - offCount} of {scoped.length} enabled
                    </Typography.Text>
                    {offCount > 0 ? (
                        <Button
                            type="link"
                            size="small"
                            disabled={togglesDisabled}
                            onClick={() =>
                                setDisabledItems(disabledItems.filter((id) => !scoped.includes(id)))
                            }
                            className="h-auto p-0 text-[11px]"
                        >
                            Enable all
                        </Button>
                    ) : null}
                </div>
            )
        },
        [disabledSet, disabledItems, setDisabledItems, togglesDisabled],
    )
    const itemToggle = useCallback(
        (id: string | undefined) =>
            id
                ? {
                      checked: !disabledSet.has(id),
                      onChange: (checked: boolean) => setItemEnabled(id, checked),
                      disabled: togglesDisabled,
                  }
                : undefined,
        [disabledSet, setItemEnabled, togglesDisabled],
    )

    const buildKitSection = hasBuildKitOverlay ? (
        <ConfigAccordionSection
            size="compact"
            defaultOpen={false}
            icon={<Wrench size={15} />}
            title="Playground build kit"
            summary={
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--ag-colorWarning)]" />
                    Removed on commit
                </span>
            }
            extra={
                <Switch
                    checked={buildKitEnabled}
                    onChange={setBuildKitEnabled}
                    disabled={disabled}
                />
            }
        >
            <Typography.Text type="secondary" className="text-[11px] leading-snug">
                These playground-only tools, skills, and permissions help the assistant build and
                revise this agent. None of this is part of the published agent.
            </Typography.Text>
            {!buildKitEnabled ? (
                <div className="rounded border border-solid border-[var(--ant-color-info-border)] bg-[var(--ant-color-info-bg)] px-2.5 py-2 text-[11.5px] leading-snug text-[var(--ant-color-info-text)]">
                    The assistant can no longer create files, run code, or edit the agent here.
                </div>
            ) : null}
            {platformOverlayTools.length > 0 ? (
                <RailField
                    label={railLabel("Platform tools", platformOverlayTools.map(buildKitToolId))}
                >
                    <div className="flex flex-col gap-1.5">
                        {platformOverlayTools.map((tool, index) => (
                            <ItemRow
                                key={`build-kit-platform-tool-${index}`}
                                descriptor={describeBuildKitPlatformTool(tool)}
                                locked
                                toggle={itemToggle(buildKitToolId(tool))}
                            />
                        ))}
                    </div>
                </RailField>
            ) : null}
            {embeddedOverlayTools.length > 0 ? (
                <RailField
                    label={railLabel("Embedded tools", embeddedOverlayTools.map(buildKitToolId))}
                >
                    <div className="flex flex-col gap-1.5">
                        {embeddedOverlayTools.map((tool, index) => (
                            <ItemRow
                                key={`build-kit-embedded-tool-${index}`}
                                descriptor={describeBuildKitEmbed(tool, "tool")}
                                locked
                                toggle={itemToggle(buildKitToolId(tool))}
                            />
                        ))}
                    </div>
                </RailField>
            ) : null}
            {embeddedOverlaySkills.length > 0 ? (
                <RailField
                    label={railLabel("Embedded skills", embeddedOverlaySkills.map(buildKitSkillId))}
                >
                    <div className="flex flex-col gap-1.5">
                        {embeddedOverlaySkills.map((skill, index) => (
                            <ItemRow
                                key={`build-kit-embedded-skill-${index}`}
                                descriptor={describeBuildKitEmbed(skill, "skill")}
                                locked
                                toggle={itemToggle(buildKitSkillId(skill))}
                            />
                        ))}
                    </div>
                </RailField>
            ) : null}
            {overlayPermissions && Object.keys(overlayPermissions).length > 0 ? (
                <RailField label="Sandbox permissions">
                    <div className="flex flex-col gap-1.5 opacity-70">
                        {Object.entries(overlayPermissions).map(([key, value]) => (
                            <div
                                key={key}
                                className="flex items-center justify-between gap-3 rounded border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ant-color-fill-quaternary)] px-3 py-2 text-xs"
                            >
                                <span className="font-mono">{key}</span>
                                <Tag className="m-0 font-mono text-[11px]">
                                    {formatPermissionValue(value)}
                                </Tag>
                            </div>
                        ))}
                    </div>
                </RailField>
            ) : null}
        </ConfigAccordionSection>
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
