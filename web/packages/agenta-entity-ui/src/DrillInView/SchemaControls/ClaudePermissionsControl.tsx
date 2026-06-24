/**
 * ClaudePermissionsControl
 *
 * Layer 1 of the agent capability config, Claude-only: the Claude harness's own permission knobs.
 * These map 1:1 to Claude Code's `permissions` settings block and persist into the neutral
 * `harness_options.claude.permissions` bag on the agent config (the SDK's `ClaudePermissions`,
 * agenta.sdk.agents.dtos). The shape:
 *   { default_mode?: "default"|"acceptEdits"|"plan"|"bypassPermissions",
 *     allow: string[], deny: string[], ask: string[] }
 *
 * It is rendered as a collapsed "advanced" section by AgentConfigControl and is hidden when the
 * harness is not Claude (nothing here applies to Pi, which never gates tool use). Non-destructive:
 * an author who touches nothing leaves `harness_options` untouched.
 */
import {memo, useCallback, useMemo} from "react"

import {LabeledField} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {Input, Select} from "antd"

type ClaudePermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions"

interface ClaudePermissionsValue {
    default_mode?: ClaudePermissionMode | null
    allow?: string[]
    deny?: string[]
    ask?: string[]
}

export interface ClaudePermissionsControlProps {
    /** The `harness_options.claude.permissions` value (object or null/undefined). */
    value?: Record<string, unknown> | null
    /** Called with the next permissions object. */
    onChange: (value: Record<string, unknown>) => void
    /** Disable the control */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
}

const MODE_OPTIONS: {value: ClaudePermissionMode; label: string}[] = [
    {value: "default", label: "Default (prompt on each gated tool)"},
    {value: "acceptEdits", label: "Accept edits (auto-accept file edits)"},
    {value: "plan", label: "Plan (read-only planning)"},
    {value: "bypassPermissions", label: "Bypass (skip every gate)"},
]

/** Read the current value, defaulting the rule lists to empty arrays. */
function readValue(value: Record<string, unknown> | null | undefined): {
    defaultMode: ClaudePermissionMode | null
    allow: string[]
    deny: string[]
    ask: string[]
} {
    const v = (value ?? {}) as ClaudePermissionsValue
    return {
        defaultMode: (v.default_mode as ClaudePermissionMode | null | undefined) ?? null,
        allow: Array.isArray(v.allow) ? v.allow : [],
        deny: Array.isArray(v.deny) ? v.deny : [],
        ask: Array.isArray(v.ask) ? v.ask : [],
    }
}

/** Split a textarea (one rule per line) into a trimmed, non-empty rule list. */
function parseRules(text: string): string[] {
    return text
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
}

export const ClaudePermissionsControl = memo(function ClaudePermissionsControl({
    value,
    onChange,
    disabled = false,
    className,
}: ClaudePermissionsControlProps) {
    const current = useMemo(() => readValue(value), [value])

    // Compose the full permissions object, overriding one slice. `default_mode` is only written
    // when set so an author who only edits rules never emits a null mode.
    const write = useCallback(
        (patch: {
            defaultMode?: ClaudePermissionMode | null
            allow?: string[]
            deny?: string[]
            ask?: string[]
        }) => {
            const next = {...current, ...patch}
            const out: Record<string, unknown> = {
                allow: next.allow,
                deny: next.deny,
                ask: next.ask,
            }
            if (next.defaultMode) out.default_mode = next.defaultMode
            onChange(out)
        },
        [current, onChange],
    )

    return (
        <div className={cn("flex flex-col gap-2", className)}>
            <LabeledField
                label="Permission mode"
                description="Claude Code's default permission mode for this headless run."
                withTooltip
            >
                <Select<ClaudePermissionMode>
                    value={current.defaultMode ?? undefined}
                    onChange={(v) => write({defaultMode: v ?? null})}
                    options={MODE_OPTIONS}
                    disabled={disabled}
                    placeholder="Claude default"
                    allowClear
                    className="w-full"
                    size="small"
                />
            </LabeledField>

            <LabeledField
                label="Allow rules"
                description='Per-tool allow rules, one per line (e.g. "Read", "Bash(npm run:*)").'
                withTooltip
            >
                <Input.TextArea
                    value={current.allow.join("\n")}
                    onChange={(e) => write({allow: parseRules(e.target.value)})}
                    disabled={disabled}
                    placeholder={"Read\nBash(npm run:*)"}
                    rows={2}
                    className="resize-y font-mono text-xs"
                />
            </LabeledField>

            <LabeledField
                label="Ask rules"
                description="Per-tool rules that prompt before use, one per line."
                withTooltip
            >
                <Input.TextArea
                    value={current.ask.join("\n")}
                    onChange={(e) => write({ask: parseRules(e.target.value)})}
                    disabled={disabled}
                    placeholder="Bash(rm:*)"
                    rows={2}
                    className="resize-y font-mono text-xs"
                />
            </LabeledField>

            <LabeledField
                label="Deny rules"
                description="Per-tool rules that are always blocked, one per line."
                withTooltip
            >
                <Input.TextArea
                    value={current.deny.join("\n")}
                    onChange={(e) => write({deny: parseRules(e.target.value)})}
                    disabled={disabled}
                    placeholder={"Write\nmcp__server__tool"}
                    rows={2}
                    className="resize-y font-mono text-xs"
                />
            </LabeledField>
        </div>
    )
})
