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

import {useT, type CatalogKey} from "@agenta/i18n"
import permissionsCatalog from "@agenta/i18n/catalogs/entityUi.permissions"
import {
    AutosizeTextarea,
    Combobox,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"

import {RailField, railInfoLabel} from "../../drawers/shared/RailField"

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

type PermissionsKey = CatalogKey<typeof permissionsCatalog>

const NETWORK_MODE_OPTIONS: {value: NetworkMode; label: PermissionsKey}[] = [
    {value: "on", label: "entityUi.permissions.networkAllowAll"},
    {value: "off", label: "entityUi.permissions.networkBlockAll"},
    {value: "allowlist", label: "entityUi.permissions.networkAllowlist"},
]

const FILESYSTEM_OPTIONS: {value: FilesystemMode; label: PermissionsKey}[] = [
    {value: "on", label: "entityUi.permissions.fsReadWrite"},
    {value: "readonly", label: "entityUi.permissions.fsReadOnly"},
    {value: "off", label: "entityUi.permissions.fsNoAccess"},
]

const ENFORCEMENT_OPTIONS: {value: Enforcement; label: PermissionsKey}[] = [
    {value: "strict", label: "entityUi.permissions.enforcementStrict"},
    {value: "best_effort", label: "entityUi.permissions.enforcementBestEffort"},
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
    const t = useT(permissionsCatalog)
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
        <>
            {/* `path` = the dot-path the commit-diff classifier flattens this knob to, so a row with
                an uncommitted change marks itself (see ChangedPathsProvider). */}
            <RailField
                label={railInfoLabel(
                    t("entityUi.permissions.networkEgress"),
                    t("entityUi.permissions.networkEgressHint"),
                )}
                align="center"
                path="sandbox.permissions.network.mode"
            >
                <Select
                    value={current.networkMode}
                    onValueChange={(v) => write({networkMode: v as NetworkMode})}
                    disabled={disabled}
                >
                    <SelectTrigger
                        className="w-full"
                        aria-label={t("entityUi.permissions.networkEgress")}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {NETWORK_MODE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                                {t(o.label)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </RailField>

            {current.networkMode === "allowlist" ? (
                <RailField
                    label={railInfoLabel(
                        t("entityUi.permissions.allowlist"),
                        t("entityUi.permissions.allowlistHint"),
                    )}
                    path="sandbox.permissions.network.allowlist"
                >
                    <AutosizeTextarea
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
                        aria-label={t("entityUi.permissions.allowlist")}
                        className="font-mono"
                    />
                </RailField>
            ) : null}

            <RailField
                label={railInfoLabel(
                    t("entityUi.permissions.filesystem"),
                    t("entityUi.permissions.filesystemHint"),
                )}
                align="center"
                path="sandbox.permissions.filesystem"
            >
                {/* Combobox, not Select: this knob is clearable (antd `allowClear`) and Radix
                    Select has no clear affordance. */}
                <Combobox
                    value={current.filesystem ?? undefined}
                    onChange={(v) => write({filesystem: (v as FilesystemMode | undefined) ?? null})}
                    options={FILESYSTEM_OPTIONS.map((o) => ({value: o.value, label: t(o.label)}))}
                    disabled={disabled}
                    placeholder={t("entityUi.permissions.notDeclared")}
                    allowClear
                    aria-label={t("entityUi.permissions.filesystem")}
                    className="w-full"
                />
            </RailField>

            <RailField
                label={railInfoLabel(
                    t("entityUi.permissions.enforcement"),
                    t("entityUi.permissions.enforcementHint"),
                )}
                align="center"
                path="sandbox.permissions.enforcement"
            >
                <Select
                    value={current.enforcement}
                    onValueChange={(v) => write({enforcement: v as Enforcement})}
                    disabled={disabled}
                >
                    <SelectTrigger
                        className="w-full"
                        aria-label={t("entityUi.permissions.enforcement")}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {ENFORCEMENT_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                                {t(o.label)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </RailField>
        </>
    )
}
