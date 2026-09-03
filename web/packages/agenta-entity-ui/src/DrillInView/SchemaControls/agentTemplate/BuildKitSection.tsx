/**
 * BuildKitSection / PermissionOverrideHint — the presentational half of `useBuildKit`.
 *
 * The hook owns the atom reads (overlay + enabled flag) and the derivation; everything that
 * renders lives here so it can be storied with plain props (container reads atoms,
 * presentational takes props).
 */
import type {ReactNode} from "react"

import {Tag} from "@agenta/ui/components/presentational"
import {Switch, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {Warning} from "@phosphor-icons/react"

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

/** One build-kit row. `toggle` marks a tool the user may switch off; without it the row is locked. */
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
}: BuildKitSectionProps) {
    // Per-tool switches only mean anything while the kit as a whole is on.
    const toolsDisabled = Boolean(disabled) || !enabled
    // Counted over every row, so the number adds up against the list on screen.
    const enabledCount = tools.filter((tool) => tool.toggle?.enabled ?? true).length
    const allEnabled = tools.every((tool) => tool.toggle?.enabled ?? true)
    // Nothing to switch means no bulk action — the button would be a dead control.
    const hasSwitchableTools = tools.some((tool) => tool.toggle)
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-xs font-medium">Playground build kit</span>
                    <Switch
                        checked={enabled}
                        onCheckedChange={onEnabledChange}
                        disabled={disabled}
                        aria-label="Enable the playground build kit"
                    />
                </div>
                <span className="text-xs leading-snug text-colorTextDescription">
                    These playground-only tools and permissions help the assistant build and revise
                    this agent. None of this is part of the published agent.
                </span>
            </div>
            {!enabled ? (
                <div className="rounded border border-solid border-[var(--ant-color-info-border)] bg-[var(--ant-color-info-bg)] px-2.5 py-2 text-xs leading-snug text-[var(--ant-color-info-text)]">
                    The assistant can no longer create files, run code, or edit the agent here.
                </div>
            ) : null}
            {tools.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-baseline gap-2 text-xs text-colorTextDescription">
                        <span>Tools</span>
                        <span className="min-w-0 flex-1 text-[11px]">
                            {enabledCount} of {tools.length} enabled
                        </span>
                        {hasSwitchableTools ? (
                            <button
                                type="button"
                                disabled={toolsDisabled}
                                onClick={() => onSetAllTools(!allEnabled)}
                                className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-inherit underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {allEnabled ? "Disable all" : "Enable all"}
                            </button>
                        ) : null}
                    </div>
                    {tools.map(({key, descriptor, toggle}) => (
                        <ItemRow
                            key={`build-kit-tool-${key}`}
                            descriptor={descriptor}
                            locked={!toggle}
                            inactive={!enabled || (toggle ? !toggle.enabled : false)}
                            extra={
                                toggle ? (
                                    <Switch
                                        size="sm"
                                        checked={toggle.enabled}
                                        disabled={toolsDisabled}
                                        onCheckedChange={(next) => onToggleTool(toggle.op, next)}
                                        // The readable name, not the wire `op`.
                                        aria-label={descriptor.name}
                                    />
                                ) : undefined
                            }
                        />
                    ))}
                </div>
            ) : null}
            {permissions && Object.keys(permissions).length > 0 ? (
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-colorTextDescription">Sandbox permissions</span>
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
                </div>
            ) : null}
        </div>
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
