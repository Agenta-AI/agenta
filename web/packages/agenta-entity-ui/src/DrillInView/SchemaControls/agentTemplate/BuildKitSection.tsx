/**
 * BuildKitSection - the presentational half of `useBuildKit`.
 *
 * The hook owns the atom reads (overlay + enabled flag) and the derivation; everything that
 * renders lives here so it can be storied with plain props (container reads atoms,
 * presentational takes props).
 */
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {Switch} from "@agenta/ui/ui"
import {Wrench} from "@phosphor-icons/react"

import {RailField} from "../../../drawers/shared/RailField"

import type {ItemDescriptor} from "./itemDescriptors"
import {ItemRow} from "./ItemRow"

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
    /** Collapsed in the app (it is background information); stories open it. @default false */
    defaultOpen?: boolean
}

/** The build-kit block. Switchable tools get a switch each; the rest are read-only. */
export function BuildKitSection({
    enabled,
    onEnabledChange,
    disabled,
    tools,
    onToggleTool,
    onSetAllTools,
    defaultOpen = false,
}: BuildKitSectionProps) {
    // Per-tool switches only mean anything while the kit as a whole is on.
    const toolsDisabled = Boolean(disabled) || !enabled
    // Counted over every row, so the number adds up against the list on screen.
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
                </RailField>
            ) : null}
        </ConfigAccordionSection>
    )
}
