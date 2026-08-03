/**
 * BuildKitSection / PermissionOverrideHint — the presentational half of `useBuildKit`.
 *
 * The hook owns the atom reads (overlay + enabled flag) and the derivation; everything that
 * renders lives here so it can be storied with plain props (container reads atoms,
 * presentational takes props).
 */
import type {ReactNode} from "react"

import {ConfigAccordionSection, Tag} from "@agenta/ui/components/presentational"
import {Switch, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {Warning, Wrench} from "@phosphor-icons/react"

import {RailField} from "../../../drawers/shared/RailField"

import type {ItemDescriptor} from "./itemDescriptors"
import {ItemRow} from "./ItemRow"

export function formatPermissionValue(value: unknown): string {
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    if (value == null) return "null"
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

export interface BuildKitSectionProps {
    /** Build-kit on/off (the persisted atom, or a drawer's draft buffer). */
    enabled: boolean
    onEnabledChange: (value: boolean) => void
    disabled?: boolean
    platformTools: ItemDescriptor[]
    embeddedTools: ItemDescriptor[]
    embeddedSkills: ItemDescriptor[]
    /** Sandbox permission overlay, rendered read-only as `key → value` rows. */
    permissions?: Record<string, unknown> | null
    /** Collapsed in the app (it is background information); stories open it. @default false */
    defaultOpen?: boolean
}

/** The read-only build-kit block: enable switch, caption, and the overlay's items/permissions. */
export function BuildKitSection({
    enabled,
    onEnabledChange,
    disabled,
    platformTools,
    embeddedTools,
    embeddedSkills,
    permissions,
    defaultOpen = false,
}: BuildKitSectionProps) {
    return (
        <ConfigAccordionSection
            size="compact"
            defaultOpen={defaultOpen}
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
                    checked={enabled}
                    onCheckedChange={onEnabledChange}
                    disabled={disabled}
                    aria-label="Enable the playground build kit"
                />
            }
        >
            <span className="text-[11px] leading-snug text-colorTextDescription">
                These playground-only tools, skills, and permissions help the assistant build and
                revise this agent. None of this is part of the published agent.
            </span>
            {!enabled ? (
                <div className="rounded border border-solid border-[var(--ant-color-info-border)] bg-[var(--ant-color-info-bg)] px-2.5 py-2 text-[11.5px] leading-snug text-[var(--ant-color-info-text)]">
                    The assistant can no longer create files, run code, or edit the agent here.
                </div>
            ) : null}
            {platformTools.length > 0 ? (
                <RailField label="Platform tools">
                    {platformTools.map((descriptor, index) => (
                        <ItemRow
                            key={`build-kit-platform-tool-${index}`}
                            descriptor={descriptor}
                            locked
                        />
                    ))}
                </RailField>
            ) : null}
            {embeddedTools.length > 0 ? (
                <RailField label="Embedded tools">
                    {embeddedTools.map((descriptor, index) => (
                        <ItemRow
                            key={`build-kit-embedded-tool-${index}`}
                            descriptor={descriptor}
                            locked
                        />
                    ))}
                </RailField>
            ) : null}
            {embeddedSkills.length > 0 ? (
                <RailField label="Embedded skills">
                    {embeddedSkills.map((descriptor, index) => (
                        <ItemRow
                            key={`build-kit-embedded-skill-${index}`}
                            descriptor={descriptor}
                            locked
                        />
                    ))}
                </RailField>
            ) : null}
            {permissions && Object.keys(permissions).length > 0 ? (
                <RailField label="Sandbox permissions">
                    <div className="flex flex-col gap-1.5 opacity-70">
                        {Object.entries(permissions).map(([key, value]) => (
                            <div
                                key={key}
                                className="flex items-center justify-between gap-3 rounded border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ant-color-fill-quaternary)] px-3 py-2 text-xs"
                            >
                                <span className="font-mono">{key}</span>
                                {/* leading-[22.4px]: antd's `.ant-tag` keeps its own 22.4px
                                    line-height under a font-size override, but `text-[11px]`
                                    replaces the Badge ramp's bundled line-height — restate it
                                    or the chip renders 6px shorter. */}
                                <Tag className="font-mono text-[11px] leading-[22.4px]">
                                    {formatPermissionValue(value)}
                                </Tag>
                            </div>
                        ))}
                    </div>
                </RailField>
            ) : null}
        </ConfigAccordionSection>
    )
}

/** Inline warning above SandboxPermissionControl when the build kit overrides a permission. */
export function PermissionOverrideHint({keys}: {keys: string[]}): ReactNode {
    if (keys.length === 0) return null
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="inline-flex w-fit items-center gap-1.5 rounded bg-[var(--ant-color-warning-bg)] px-2 py-1 text-[11px] text-[var(--ant-color-warning-text)]">
                        <Warning size={12} />
                        Build kit overrides {keys.join(", ")}
                    </div>
                </TooltipTrigger>
                <TooltipContent>
                    This value is overridden by the build kit in playground. Turn the build kit off
                    to match the published agent.
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
