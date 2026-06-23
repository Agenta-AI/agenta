/**
 * SandboxPermissionControl
 *
 * Layer 2 of the agent capability config: the sandbox security boundary the agent runs inside
 * (`sandbox_permission` on the agent config). It applies to every harness. The shape mirrors
 * the SDK's `SandboxPermission` (agenta.sdk.agents.dtos):
 *   { network: { mode: "on"|"off"|"allowlist", allowlist: string[] },
 *     filesystem?: "on"|"readonly"|"off",
 *     enforcement: "strict"|"best_effort" }
 *
 * The emitted `agent_config` schema exposes `sandbox_permission` as a nullable object (anyOf),
 * so the generic SchemaPropertyRenderer can only show a "click to expand" drill-in indicator for
 * it. This control renders the four knobs as a real form instead: a network-mode selector, a
 * CIDR allowlist shown only when mode = allowlist, a filesystem selector, and an enforcement
 * toggle. It is non-destructive: an unset value stays `null` (no declared boundary) until the
 * author changes something.
 */
import {memo, useCallback, useMemo} from "react"

import {LabeledField} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {Input, Select, Typography} from "antd"

type NetworkMode = "on" | "off" | "allowlist"
type FilesystemMode = "on" | "readonly" | "off"
type Enforcement = "strict" | "best_effort"

interface NetworkEgress {
    mode: NetworkMode
    allowlist: string[]
}

interface SandboxPermissionValue {
    network?: NetworkEgress
    filesystem?: FilesystemMode | null
    enforcement?: Enforcement
}

export interface SandboxPermissionControlProps {
    /** The `sandbox_permission` value (object or null) from the agent config. */
    value?: Record<string, unknown> | null
    /** Called with the next `sandbox_permission` object (never null once the author touches it). */
    onChange: (value: Record<string, unknown>) => void
    /** Disable the control */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
}

const NETWORK_MODE_OPTIONS: {value: NetworkMode; label: string}[] = [
    {value: "on", label: "Allow all egress"},
    {value: "off", label: "Block all egress"},
    {value: "allowlist", label: "Allowlist (CIDR ranges)"},
]

const FILESYSTEM_OPTIONS: {value: FilesystemMode; label: string}[] = [
    {value: "on", label: "Read/write"},
    {value: "readonly", label: "Read-only"},
    {value: "off", label: "No access"},
]

const ENFORCEMENT_OPTIONS: {value: Enforcement; label: string}[] = [
    {value: "strict", label: "Strict (fail if unenforceable)"},
    {value: "best_effort", label: "Best effort"},
]

/** Read the current value with the same defaults the SDK applies, so the form is never blank. */
function readValue(value: Record<string, unknown> | null | undefined): {
    networkMode: NetworkMode
    allowlist: string[]
    filesystem: FilesystemMode | null
    enforcement: Enforcement
} {
    const v = (value ?? {}) as SandboxPermissionValue
    const network = (v.network ?? {}) as NetworkEgress
    return {
        networkMode: network.mode ?? "on",
        allowlist: Array.isArray(network.allowlist) ? network.allowlist : [],
        filesystem: (v.filesystem as FilesystemMode | null | undefined) ?? null,
        enforcement: v.enforcement ?? "strict",
    }
}

export const SandboxPermissionControl = memo(function SandboxPermissionControl({
    value,
    onChange,
    disabled = false,
    className,
}: SandboxPermissionControlProps) {
    const current = useMemo(() => readValue(value), [value])

    // Compose the full `sandbox_permission` object from the current state, overriding one slice.
    // We always write the network object (with mode + allowlist) and enforcement; filesystem is
    // only written when set (it is declared, not enforced, and stays omitted otherwise).
    const write = useCallback(
        (patch: {
            networkMode?: NetworkMode
            allowlist?: string[]
            filesystem?: FilesystemMode | null
            enforcement?: Enforcement
        }) => {
            const next = {...current, ...patch}
            const out: Record<string, unknown> = {
                network: {
                    mode: next.networkMode,
                    allowlist: next.networkMode === "allowlist" ? next.allowlist : [],
                },
                enforcement: next.enforcement,
            }
            if (next.filesystem) out.filesystem = next.filesystem
            onChange(out)
        },
        [current, onChange],
    )

    return (
        <div className={cn("flex flex-col gap-2", className)}>
            <Typography.Text className="text-sm font-medium">Sandbox permissions</Typography.Text>

            <LabeledField
                label="Network egress"
                description="Outbound network access for the sandbox. Declared config; enforced by the runner in a later slice."
                withTooltip
            >
                <Select<NetworkMode>
                    value={current.networkMode}
                    onChange={(v) => write({networkMode: v})}
                    options={NETWORK_MODE_OPTIONS}
                    disabled={disabled}
                    className="w-full"
                    size="small"
                />
            </LabeledField>

            {current.networkMode === "allowlist" && (
                <LabeledField
                    label="Allowlist"
                    description="CIDR ranges allowed for outbound egress, one per line (e.g. 10.0.0.0/8)."
                    withTooltip
                >
                    <Input.TextArea
                        value={current.allowlist.join("\n")}
                        onChange={(e) =>
                            write({
                                allowlist: e.target.value
                                    .split("\n")
                                    .map((s) => s.trim())
                                    .filter(Boolean),
                            })
                        }
                        disabled={disabled}
                        placeholder={"10.0.0.0/8\n192.168.0.0/16"}
                        rows={3}
                        className="resize-y font-mono text-xs"
                    />
                </LabeledField>
            )}

            <LabeledField
                label="Filesystem"
                description="Declared filesystem access for the sandbox. Optional; leave unset for no declared boundary."
                withTooltip
            >
                <Select<FilesystemMode>
                    value={current.filesystem ?? undefined}
                    onChange={(v) => write({filesystem: v ?? null})}
                    options={FILESYSTEM_OPTIONS}
                    disabled={disabled}
                    placeholder="Not declared"
                    allowClear
                    className="w-full"
                    size="small"
                />
            </LabeledField>

            <LabeledField
                label="Enforcement"
                description="Strict fails the run when the boundary cannot be applied; best effort continues."
                withTooltip
            >
                <Select<Enforcement>
                    value={current.enforcement}
                    onChange={(v) => write({enforcement: v})}
                    options={ENFORCEMENT_OPTIONS}
                    disabled={disabled}
                    className="w-full"
                    size="small"
                />
            </LabeledField>
        </div>
    )
})
