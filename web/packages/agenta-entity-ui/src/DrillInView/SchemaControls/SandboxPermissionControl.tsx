/**
 * SandboxPermissionControl
 *
 * The `sandbox.permissions` field of the agent template (capability config "layer 2"): the sandbox
 * security boundary the agent runs inside, applied by every harness. Mirrors the SDK shape
 * (agenta.sdk.agents.dtos `SandboxPermission`):
 *   { network: { mode: "on" | "off" | "allowlist", allowlist: string[] },
 *     filesystem?: "on" | "readonly" | "off",
 *     enforcement: "strict" | "best_effort" }
 *
 * The emitted `agent-template` schema exposes `sandbox.permissions` as a nullable object, so the
 * generic renderer can only offer a drill-in. This renders the four knobs as a real form: a
 * network-mode selector, a CIDR allowlist (only when mode = allowlist), an optional filesystem
 * selector, and an enforcement selector. Non-destructive: an unset value stays `null` (no declared
 * boundary) until the author changes something.
 */
import {useCallback, useMemo} from "react"

import {LabeledField} from "@agenta/ui/components/presentational"
import {Input, Select, Typography} from "antd"

type NetworkMode = "on" | "off" | "allowlist"
type FilesystemMode = "on" | "readonly" | "off"
type Enforcement = "strict" | "best_effort"

interface NetworkEgress {
    mode?: NetworkMode
    allowlist?: string[]
}

interface SandboxPermissionValue {
    network?: NetworkEgress
    filesystem?: FilesystemMode | null
    enforcement?: Enforcement
}

export interface SandboxPermissionControlProps {
    value?: Record<string, unknown> | null
    onChange: (value: Record<string, unknown>) => void
    disabled?: boolean
}

const NETWORK_MODE_OPTIONS: {value: NetworkMode; label: string}[] = [
    {value: "on", label: "Allow all egress"},
    {value: "off", label: "Block all egress"},
    {value: "allowlist", label: "Allowlist (CIDR ranges)"},
]

const FILESYSTEM_OPTIONS: {value: FilesystemMode; label: string}[] = [
    {value: "on", label: "Read / write"},
    {value: "readonly", label: "Read-only"},
    {value: "off", label: "No access"},
]

const ENFORCEMENT_OPTIONS: {value: Enforcement; label: string}[] = [
    {value: "strict", label: "Strict (fail if unenforceable)"},
    {value: "best_effort", label: "Best effort"},
]

/** Read the value with the SDK's defaults applied, so the form is never blank. */
function readValue(value: Record<string, unknown> | null | undefined) {
    const v = (value ?? {}) as SandboxPermissionValue
    const network = (v.network ?? {}) as NetworkEgress
    return {
        networkMode: (network.mode as NetworkMode | undefined) ?? "on",
        allowlist: Array.isArray(network.allowlist) ? network.allowlist : [],
        filesystem: (v.filesystem as FilesystemMode | null | undefined) ?? null,
        enforcement: (v.enforcement as Enforcement | undefined) ?? "strict",
    }
}

export function SandboxPermissionControl({
    value,
    onChange,
    disabled,
}: SandboxPermissionControlProps) {
    const current = useMemo(() => readValue(value), [value])

    // Compose the full object from the current state, overriding one slice. Always writes the
    // network object + enforcement; filesystem is written only when set (declared, not enforced).
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
        <div className="flex flex-col gap-3 border-0 border-t border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] pt-3">
            <Typography.Text className="text-xs font-medium">Sandbox permissions</Typography.Text>

            <LabeledField
                label="Network egress"
                description="Outbound network access for the sandbox. Declared config; enforced by the runner."
                withTooltip
            >
                <Select<NetworkMode>
                    value={current.networkMode}
                    onChange={(v) => write({networkMode: v})}
                    options={NETWORK_MODE_OPTIONS}
                    disabled={disabled}
                    className="w-full"
                />
            </LabeledField>

            {current.networkMode === "allowlist" ? (
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
                        autoSize={{minRows: 2, maxRows: 6}}
                        className="font-mono"
                    />
                </LabeledField>
            ) : null}

            <LabeledField
                label="Filesystem"
                description="Declared filesystem access for the sandbox. Optional; leave unset for no declared boundary."
                withTooltip
            >
                <Select<FilesystemMode>
                    value={current.filesystem ?? undefined}
                    onChange={(v) => write({filesystem: (v as FilesystemMode | undefined) ?? null})}
                    options={FILESYSTEM_OPTIONS}
                    disabled={disabled}
                    placeholder="Not declared"
                    allowClear
                    className="w-full"
                />
            </LabeledField>

            <LabeledField
                label="Enforcement"
                description="Strict fails the run when the boundary can't be applied; best effort continues."
                withTooltip
            >
                <Select<Enforcement>
                    value={current.enforcement}
                    onChange={(v) => write({enforcement: v})}
                    options={ENFORCEMENT_OPTIONS}
                    disabled={disabled}
                    className="w-full"
                />
            </LabeledField>
        </div>
    )
}
