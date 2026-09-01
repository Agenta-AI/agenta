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

/**
 * One row of the build kit. `toggle` marks a tool the user may switch off; a row without it is
 * Agenta-owned and always on. They render as ONE list (#6025) — the split between platform tools
 * and embedded tools/skills is an implementation detail the reader has no use for.
 */
export interface BuildKitTool {
    /** Stable React key: the `op` for a platform tool, the embed slug or index otherwise. */
    key: string
    descriptor: ItemDescriptor
    toggle?: {op: string; enabled: boolean}
}

export interface BuildKitSectionProps {
    /** Build-kit master on/off (the persisted atom, or a drawer's draft buffer). */
    enabled: boolean
    onEnabledChange: (value: boolean) => void
    disabled?: boolean
    tools: BuildKitTool[]
    /** Switch one tool on or off. */
    onToggleTool: (op: string, next: boolean) => void
    /** Switch every switchable tool on or off at once. */
    onSetAllTools: (next: boolean) => void
    /** Sandbox permission overlay, rendered read-only as `key → value` rows. */
    permissions?: Record<string, unknown> | null
    /** Collapsed in the app (it is background information); stories open it. @default false */
    defaultOpen?: boolean
}

/** The build-kit block. Switchable tools get a switch each; the rest, and permissions, are read-only. */
export function BuildKitSection({
    enabled,
    onEnabledChange,
    disabled,
    tools,
    onToggleTool,
    onSetAllTools,
    permissions,
    defaultOpen = false,
}: BuildKitSectionProps) {
    // Per-tool switches only mean anything while the kit as a whole is on.
    const toolsDisabled = Boolean(disabled) || !enabled
    // Counted over every row, not just the switchable ones: a count that skipped the locked rows
    // would not add up against the list the reader is looking at.
    const enabledCount = tools.filter((tool) => tool.toggle?.enabled ?? true).length
    const allEnabled = tools.every((tool) => tool.toggle?.enabled ?? true)
    // Nothing to switch means no bulk action — the button would be a dead control.
    const hasSwitchableTools = tools.some((tool) => tool.toggle)
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
            <span className="text-xs leading-snug text-colorTextDescription">
                These playground-only tools and permissions help the assistant build and revise this
                agent. None of this is part of the published agent.
            </span>
            {!enabled ? (
                <div className="rounded border border-solid border-[var(--ant-color-info-border)] bg-[var(--ant-color-info-bg)] px-2.5 py-2 text-xs leading-snug text-[var(--ant-color-info-text)]">
                    The assistant can no longer create files, run code, or edit the agent here.
                </div>
            ) : null}
            {tools.length > 0 ? (
                <RailField
                    wide
                    label={
                        <span className="flex flex-col items-start gap-1">
                            <span>Tools</span>
                            <span className="text-[11px] leading-tight text-colorTextDescription">
                                {enabledCount} of {tools.length} enabled
                            </span>
                            {hasSwitchableTools ? (
                                <button
                                    type="button"
                                    disabled={toolsDisabled}
                                    onClick={() => onSetAllTools(!allEnabled)}
                                    className="cursor-pointer border-0 bg-transparent p-0 text-[11px] underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {allEnabled ? "Disable all" : "Enable all"}
                                </button>
                            ) : null}
                        </span>
                    }
                >
                    {tools.map(({key, descriptor, toggle}) => (
                        <ItemRow
                            key={`build-kit-tool-${key}`}
                            descriptor={descriptor}
                            locked={!toggle}
                            inactive={toggle ? !toggle.enabled || !enabled : false}
                            extra={
                                toggle ? (
                                    <Switch
                                        size="sm"
                                        checked={toggle.enabled}
                                        disabled={toolsDisabled}
                                        onCheckedChange={(next) => onToggleTool(toggle.op, next)}
                                        // The readable name, not the wire `op`: a screen reader
                                        // gets the same words the row shows.
                                        aria-label={descriptor.name}
                                    />
                                ) : undefined
                            }
                        />
                    ))}
                </RailField>
            ) : null}
            {permissions && Object.keys(permissions).length > 0 ? (
                <RailField wide label="Sandbox permissions">
                    <div className="flex flex-col gap-1.5 opacity-70">
                        {Object.entries(permissions).map(([key, value]) => (
                            <div
                                key={key}
                                className="flex items-center justify-between gap-3 rounded border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ant-color-fill-quaternary)] px-3 py-2 text-xs"
                            >
                                <span className="font-mono">{key}</span>
                                {/* leading-[22.4px]: antd's `.ant-tag` keeps its own 22.4px
                                    line-height under a font-size override, but `text-xs`
                                    replaces the Badge ramp's bundled line-height — restate it
                                    or the chip renders 6px shorter. */}
                                <Tag className="font-mono text-xs leading-[22.4px]">
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
                    <div className="inline-flex w-fit items-center gap-1.5 rounded bg-[var(--ant-color-warning-bg)] px-2 py-1 text-xs text-[var(--ant-color-warning-text)]">
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
