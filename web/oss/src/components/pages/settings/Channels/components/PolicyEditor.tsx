import type {AgentaApi} from "@agentaai/api-client"
import {Select, Switch, Tooltip, Typography} from "antd"

const TRIGGER_OPTIONS: {label: string; value: AgentaApi.ChannelTriggerKind}[] = [
    {label: "Mention", value: "mention"},
    {label: "Command", value: "command"},
    {label: "Action", value: "action"},
]

const SESSION_SCOPE_OPTIONS: {label: string; value: AgentaApi.ChannelSessionScope}[] = [
    {label: "Thread", value: "thread"},
    {label: "Message", value: "message"},
]

const LEVEL_LABEL: Record<AgentaApi.ChannelPolicyLevel, string> = {
    capability: "the channel's capability",
    channel: "the channel default",
    agent: "the agent",
    space: "the space",
    grant: "the grant",
}

export type DecidedByAnnotation =
    | {kind: "none"}
    | {kind: "capability-denied"; text: string}
    | {kind: "inert"; decidingLevel: AgentaApi.ChannelPolicyLevel; text: string}
    | {kind: "decided-here"; text: string}

/**
 * Pure classification behind `DecidedByBadge` — kept as a standalone function
 * so the three cases (capability-denied / enabled-but-inert / decided-here)
 * are unit-testable without rendering: D25's central requirement is that
 * every control shows which level decided it, not just its own value.
 */
export function decidedByAnnotation(
    level: AgentaApi.ChannelPolicyLevel | undefined,
    editingLevel: AgentaApi.ChannelPolicyLevel,
): DecidedByAnnotation {
    if (!level) return {kind: "none"}

    if (level === "capability") {
        return {kind: "capability-denied", text: "disabled — the channel does not support this"}
    }

    if (level !== editingLevel) {
        return {
            kind: "inert",
            decidingLevel: level,
            text: `decided by ${LEVEL_LABEL[level]} — editing here will not change the outcome`,
        }
    }

    return {kind: "decided-here", text: "decided here"}
}

interface DecidedByBadgeProps {
    level: AgentaApi.ChannelPolicyLevel | undefined
    editingLevel: AgentaApi.ChannelPolicyLevel
}

/**
 * Names the level that decided a field: every
 * policy control is paired with an indicator, not a bare checkbox. Disabled
 * + reasoned when capability denies it; enabled-but-annotated when a level
 * other than the one being edited decided it.
 */
export function DecidedByBadge({level, editingLevel}: DecidedByBadgeProps) {
    const annotation = decidedByAnnotation(level, editingLevel)

    if (annotation.kind === "none") return null

    if (annotation.kind === "capability-denied") {
        return (
            <Typography.Text type="secondary" className="text-xs">
                {annotation.text}
            </Typography.Text>
        )
    }

    if (annotation.kind === "inert") {
        return (
            <Typography.Text type="warning" className="text-xs">
                {annotation.text}
            </Typography.Text>
        )
    }

    return (
        <Typography.Text type="secondary" className="text-xs">
            {annotation.text}
        </Typography.Text>
    )
}

export type TriStateSelectValue = "unstated" | "true" | "false"

/** boolean|null|undefined -> the select's string value. Unstated and null share a slot:
 * both read as "no opinion", the shape `ChannelPolicy` actually stores. */
export function toTriStateSelectValue(value: boolean | null | undefined): TriStateSelectValue {
    if (value === undefined || value === null) return "unstated"
    return value ? "true" : "false"
}

/** The select's string value -> boolean|undefined for the draft document.
 * "unstated" MUST produce `undefined`, never `false` — this is the exact
 * round-trip the spec's "clearing back to no opinion" fixture pins. */
export function fromTriStateSelectValue(next: TriStateSelectValue): boolean | undefined {
    if (next === "unstated") return undefined
    return next === "true"
}

interface TriStateBooleanFieldProps {
    label: string
    value: boolean | null | undefined
    onChange: (next: boolean | null | undefined) => void
    decidedBy?: AgentaApi.ChannelPolicyLevel
    editingLevel: AgentaApi.ChannelPolicyLevel
}

/**
 * unstated / true / false — a real three-state control, not a checkbox.
 * "Unstated" round-trips as `undefined` (sent as `None`), which the D25
 * intersection treats as a different fact than `false`.
 */
export function TriStateBooleanField({
    label,
    value,
    onChange,
    decidedBy,
    editingLevel,
}: TriStateBooleanFieldProps) {
    const isCapabilityDenied = decidedBy === "capability"

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
                <Typography.Text>{label}</Typography.Text>
                <div className="flex items-center gap-2">
                    <Select<TriStateSelectValue>
                        size="small"
                        style={{width: 140}}
                        disabled={isCapabilityDenied}
                        value={toTriStateSelectValue(value)}
                        onChange={(next) => onChange(fromTriStateSelectValue(next))}
                        options={[
                            {label: "No opinion", value: "unstated"},
                            {label: "Enabled", value: "true"},
                            {label: "Disabled", value: "false"},
                        ]}
                    />
                    {isCapabilityDenied ? (
                        <Tooltip title="No policy can turn this on for this channel">
                            <Switch checked={false} disabled />
                        </Tooltip>
                    ) : null}
                </div>
            </div>
            <DecidedByBadge level={decidedBy} editingLevel={editingLevel} />
        </div>
    )
}

interface SessionScopeFieldProps {
    value: AgentaApi.ChannelSessionScope | null | undefined
    onChange: (next: AgentaApi.ChannelSessionScope | undefined) => void
    decidedBy?: AgentaApi.ChannelPolicyLevel
    editingLevel: AgentaApi.ChannelPolicyLevel
}

export function SessionScopeField({
    value,
    onChange,
    decidedBy,
    editingLevel,
}: SessionScopeFieldProps) {
    const isCapabilityDenied = decidedBy === "capability"

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
                <Typography.Text>Session scope</Typography.Text>
                <Select<string>
                    size="small"
                    style={{width: 160}}
                    disabled={isCapabilityDenied}
                    allowClear
                    placeholder="No opinion"
                    value={value ?? undefined}
                    onChange={(next) =>
                        onChange((next as AgentaApi.ChannelSessionScope) ?? undefined)
                    }
                    onClear={() => onChange(undefined)}
                    options={SESSION_SCOPE_OPTIONS}
                />
            </div>
            <DecidedByBadge level={decidedBy} editingLevel={editingLevel} />
        </div>
    )
}

interface TriggersFieldProps {
    value: AgentaApi.ChannelTriggerKind[] | null | undefined
    onChange: (next: AgentaApi.ChannelTriggerKind[] | undefined) => void
    decidedBy?: AgentaApi.ChannelPolicyLevel
    editingLevel: AgentaApi.ChannelPolicyLevel
}

/** Multi-select with clear: an empty/absent selection is "no opinion", not "none allowed". */
export function TriggersField({value, onChange, decidedBy, editingLevel}: TriggersFieldProps) {
    const isCapabilityDenied = decidedBy === "capability"

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
                <Typography.Text>Triggers</Typography.Text>
                <Select<AgentaApi.ChannelTriggerKind[]>
                    mode="multiple"
                    size="small"
                    style={{minWidth: 220}}
                    disabled={isCapabilityDenied}
                    allowClear
                    placeholder="No opinion"
                    value={value ?? []}
                    onChange={(next) => onChange(next.length ? next : undefined)}
                    onClear={() => onChange(undefined)}
                    options={TRIGGER_OPTIONS}
                />
            </div>
            <DecidedByBadge level={decidedBy} editingLevel={editingLevel} />
        </div>
    )
}

export interface PolicyEditorProps {
    /** The draft document at the level being edited — `undefined` fields mean "no opinion". */
    value: AgentaApi.ChannelPolicy
    onChange: (next: AgentaApi.ChannelPolicy) => void
    /** From `resolve_channel_policy`, for the specific pair in view. */
    decidedBy?: Record<string, AgentaApi.ChannelPolicyLevel>
    /** Which level this form edits — "agent", "space", or "grant". */
    editingLevel: AgentaApi.ChannelPolicyLevel
}

/**
 * The policy editor — writes `ChannelPolicy` at the level being edited only.
 * Never posts an effective/resolved document; that shape is response-only.
 */
export function PolicyEditor({value, onChange, decidedBy, editingLevel}: PolicyEditorProps) {
    return (
        <div className="flex flex-col gap-4">
            <TriggersField
                value={value.triggers}
                onChange={(triggers) => onChange({...value, triggers})}
                decidedBy={decidedBy?.triggers}
                editingLevel={editingLevel}
            />
            <SessionScopeField
                value={value.session_scope}
                onChange={(session_scope) => onChange({...value, session_scope})}
                decidedBy={decidedBy?.session_scope}
                editingLevel={editingLevel}
            />
            <TriStateBooleanField
                label="Backfill"
                value={value.backfill}
                onChange={(backfill) => onChange({...value, backfill: backfill ?? undefined})}
                decidedBy={decidedBy?.backfill}
                editingLevel={editingLevel}
            />
            <TriStateBooleanField
                label="Forwardfill"
                value={value.forwardfill}
                onChange={(forwardfill) =>
                    onChange({...value, forwardfill: forwardfill ?? undefined})
                }
                decidedBy={decidedBy?.forwardfill}
                editingLevel={editingLevel}
            />
        </div>
    )
}
