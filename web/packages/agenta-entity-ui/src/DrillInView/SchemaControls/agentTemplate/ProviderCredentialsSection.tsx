/**
 * ProviderCredentialsSection
 *
 * The "Provider credentials" pane: a segmented "Use API key" / "Use subscription" toggle over
 * either (a) a provider rail + key form, or (b) a self-managed info card. Vault reads/writes
 * (standard keys) happen directly against the secret entity's atoms/hooks — only the agent draft's
 * mode flows through props, because key saves are immediate and independent of the drawer draft
 * (locked decision; design.md §3.1). Connections are always the project default: there is no named-
 * connection picker here (owner call, post-design-doc) — a picked model can still auto-fill a vault
 * connection's slug (the model picker threads a vault option's `connectionSlug` metadata into
 * `useModelHarness.writeModel`), just not through a Select.
 *
 * Adding a new custom provider (Azure/Bedrock/Vertex AI/OpenAI-compatible) opens the host's
 * "Configure provider" drawer via `openConfigureProvider` (from `DrillInUIContext.llmProviderConfig`)
 * instead of an inline form — this package can't import the OSS drawer directly.
 *
 * Design: docs/design/connect-model-drawer/design.md §3, §7, §8.
 */
import {useEffect, useMemo, useState, type ReactNode} from "react"

import {
    customSecretsAtom,
    CustomProviderKind,
    PROVIDER_LABELS,
    standardSecretsAtom,
} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"
import {normalizeProviderFamily} from "@agenta/shared/utils"
import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {cn} from "@agenta/ui/styles"
import {Plus, Terminal} from "@phosphor-icons/react"
import {Segmented, Typography} from "antd"
import {useAtomValue} from "jotai"

import type {ConnectionMode} from "../connectionUtils"

import ProviderKeyField from "./ProviderKeyField"

const DEFAULT_SELF_HOSTING_GUIDE_URL = "https://docs.agenta.ai/self-host/quick-start"

export interface ProviderCredentialsSectionProps {
    // config — the agent draft's credential-relevant slice (config.llm.connection.mode)
    mode: ConnectionMode
    onModeChange: (mode: ConnectionMode) => void

    // routing/context — what the current model selection points at; auto-highlights the rail
    selectedProviderFamily: string | null

    // policy — what the environment allows
    modeOptions: ConnectionMode[]
    /** Gates the self-managed card's "Not on cloud" badge (design.md D6). The "Use subscription"
     * toggle itself is always clickable, cloud included — the card + badge are the explanation. */
    isCloud: boolean
    /** Self-hosting guide link target; falls back to the docs quick-start page. */
    selfHostingGuideUrl?: string
    /** The selected provider has a standard vault slot but no key yet — drives the header's
     * "Connect key" affordance. */
    providerNeedsKey?: boolean
    /** Opens the host's "Configure provider" drawer for a NEW provider with `kind` pre-selected.
     * Absent hides the "Add …" rows (a host with no drawer wired up). */
    openConfigureProvider?: (kind: string) => void

    // presentation
    disabled?: boolean
}

const STANDARD_PREFIX = "std:"
const CUSTOM_PREFIX = "custom:"

/** The four provider kinds the "Configure provider" drawer supports beyond the standard catalog
 * (verified against `PROVIDER_FIELDS`/`CustomProviderForm`'s `customProviders` list). */
const CUSTOM_PROVIDER_ROWS: {kind: string; label: string}[] = [
    {kind: CustomProviderKind.Azure, label: "Add Azure OpenAI"},
    {kind: CustomProviderKind.Bedrock, label: "Add Bedrock"},
    {kind: CustomProviderKind.VertexAi, label: "Add Vertex AI"},
    {kind: CustomProviderKind.Custom, label: "Add OpenAI-compatible"},
]

/** Same family match `useModelHarness`'s `providerVaultEntry` uses: env-var name minus the
 * `_API_KEY` suffix, or the title, case-insensitively. */
function standardSecretFamily(secret: LlmProvider): string {
    return normalizeProviderFamily((secret.name ?? "").replace(/_api_key$/i, ""))
}

/** Icon renderer helper (not a component): keeps the icon lookup out of render so
 * `react-hooks/static-components` doesn't see a component created during render. */
function renderProviderIcon(family: string): ReactNode {
    const Icon = getProviderIcon(family)
    return Icon ? <Icon className="h-3.5 w-3.5" /> : null
}

function ProviderTile({family, label}: {family: string; label: string}) {
    const icon = renderProviderIcon(family)
    return (
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-[var(--ag-colorFillTertiary)] text-[10px] font-semibold text-[var(--ag-colorTextSecondary)]">
            {icon ?? (label.charAt(0).toUpperCase() || "?")}
        </span>
    )
}

function RailRow({
    active,
    disabled,
    onClick,
    tile,
    label,
    hasKey,
}: {
    active: boolean
    disabled?: boolean
    onClick: () => void
    tile: ReactNode
    label: string
    hasKey?: boolean
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors",
                active
                    ? "bg-[var(--ag-colorFillSecondary)] font-semibold text-[var(--ag-colorText)]"
                    : "text-[var(--ag-colorTextSecondary)] hover:bg-[var(--ag-colorFillTertiary)] hover:text-[var(--ag-colorText)]",
            )}
        >
            {tile}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {hasKey ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
            ) : null}
        </button>
    )
}

export function ProviderCredentialsSection({
    mode,
    onModeChange,
    selectedProviderFamily,
    modeOptions,
    isCloud,
    selfHostingGuideUrl,
    providerNeedsKey,
    openConfigureProvider,
    disabled,
}: ProviderCredentialsSectionProps) {
    const standardSecrets = useAtomValue(standardSecretsAtom)
    const customSecrets = useAtomValue(customSecretsAtom)

    // The rail row matching the agent's current provider (auto-highlight); recomputed whenever the
    // model pick changes the family. Falls back to the first standard provider so the pane always
    // shows a key form.
    const autoKey = useMemo(() => {
        const family = normalizeProviderFamily(selectedProviderFamily)
        const match = family
            ? standardSecrets.find(
                  (s) =>
                      standardSecretFamily(s) === family ||
                      normalizeProviderFamily(s.title) === family,
              )
            : undefined
        const fallback = match ?? standardSecrets[0]
        return fallback ? `${STANDARD_PREFIX}${fallback.name}` : ""
    }, [standardSecrets, selectedProviderFamily])

    // `null` = follow `autoKey`; set once the user browses another provider so browsing doesn't
    // change the agent's model (design.md §3.2).
    const [manualKey, setManualKey] = useState<string | null>(null)
    useEffect(() => {
        setManualKey(null)
    }, [selectedProviderFamily])
    const activeKey = manualKey ?? autoKey

    const selectedStandardSecret = activeKey.startsWith(STANDARD_PREFIX)
        ? (standardSecrets.find((s) => s.name === activeKey.slice(STANDARD_PREFIX.length)) ?? null)
        : null

    // A selected custom-provider rail row: no inline edit form (that lives in the host's Settings →
    // Secrets drawer now), just a read-only summary so the pane isn't blank.
    const selectedCustomProvider = activeKey.startsWith(CUSTOM_PREFIX)
        ? (customSecrets.find((s) => s.name === activeKey.slice(CUSTOM_PREFIX.length)) ?? null)
        : null

    // Only offer a mode the harness actually publishes — a self_managed-only harness (no "agenta")
    // must not offer "Use API key", and vice versa. Owner rule: self_managed is always clickable
    // when capability-allowed, cloud included (isCloud only gates the badge on the card below).
    const toggleOptions = useMemo(
        () =>
            [
                modeOptions.includes("agenta") ? {label: "Use API key", value: "agenta"} : null,
                modeOptions.includes("self_managed")
                    ? {label: "Use subscription", value: "self_managed"}
                    : null,
            ].filter((option): option is {label: string; value: ConnectionMode} => option !== null),
        [modeOptions],
    )
    // Hidden entirely when there's nothing to toggle between (harness allows only one mode).
    const showToggle = toggleOptions.length > 1
    const guideUrl = selfHostingGuideUrl || DEFAULT_SELF_HOSTING_GUIDE_URL

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                    <Typography.Text className="!text-xs !font-medium !uppercase !tracking-wide !text-[var(--ag-colorTextTertiary)]">
                        Provider credentials
                    </Typography.Text>
                    {providerNeedsKey ? (
                        <span className="rounded-full border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ag-colorWarningText)]">
                            Connect key
                        </span>
                    ) : null}
                </div>
                {showToggle ? (
                    <Segmented
                        value={mode}
                        disabled={disabled}
                        onChange={(value) => onModeChange(value as ConnectionMode)}
                        options={toggleOptions}
                    />
                ) : null}
            </div>

            {mode === "self_managed" ? (
                <div className="flex flex-col items-start gap-3 rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)] p-4">
                    <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)]">
                        <Terminal size={18} className="text-[var(--ag-colorTextSecondary)]" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Typography.Text className="!text-[14.5px] !font-semibold">
                            Self-managed
                        </Typography.Text>
                        <Typography.Text type="secondary" className="!text-xs !leading-relaxed">
                            The harness signs itself in. Use your Claude Code or Codex subscription,
                            or any credentials the harness reads from its own environment, such as
                            environment variables. Agenta stores and injects no key. Requires a
                            self-hosted Agenta deployment.
                        </Typography.Text>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <a
                            href={guideUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-solid border-[var(--ag-colorBorder)] px-2.5 py-1 text-xs font-medium text-[var(--ag-colorText)] no-underline hover:bg-[var(--ag-colorFillTertiary)]"
                        >
                            Read the self-hosting guide →
                        </a>
                        {isCloud ? (
                            <span className="rounded-full border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-2 py-0.5 text-[11px] text-[var(--ag-colorWarningText)]">
                                Not on cloud
                            </span>
                        ) : null}
                    </div>
                </div>
            ) : (
                <div className="flex min-h-[236px] overflow-hidden rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)]">
                    <div className="flex w-[190px] shrink-0 flex-col gap-0.5 overflow-y-auto border-0 border-r border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] p-2">
                        {standardSecrets.map((secret) => (
                            <RailRow
                                key={secret.name}
                                active={activeKey === `${STANDARD_PREFIX}${secret.name}`}
                                disabled={disabled}
                                onClick={() => setManualKey(`${STANDARD_PREFIX}${secret.name}`)}
                                tile={
                                    <ProviderTile
                                        family={standardSecretFamily(secret)}
                                        label={secret.title ?? secret.name ?? "?"}
                                    />
                                }
                                label={secret.title ?? secret.name ?? "Provider"}
                                hasKey={!!secret.key}
                            />
                        ))}
                        {customSecrets.map((secret) => (
                            <RailRow
                                key={secret.id ?? secret.name}
                                active={activeKey === `${CUSTOM_PREFIX}${secret.name}`}
                                disabled={disabled}
                                onClick={() => setManualKey(`${CUSTOM_PREFIX}${secret.name}`)}
                                tile={
                                    <ProviderTile
                                        family={(secret.provider ?? "").toLowerCase()}
                                        label={secret.name ?? "?"}
                                    />
                                }
                                label={secret.name ?? "Custom provider"}
                                hasKey
                            />
                        ))}
                        {openConfigureProvider ? (
                            <div className="mt-1 flex flex-col gap-0.5 border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] pt-1">
                                {CUSTOM_PROVIDER_ROWS.map((row) => (
                                    <button
                                        key={row.kind}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => openConfigureProvider(row.kind)}
                                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] font-medium text-[var(--ag-colorText)] transition-colors hover:bg-[var(--ag-colorFillTertiary)]"
                                    >
                                        <Plus size={14} />
                                        {row.label}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
                        {selectedStandardSecret ? (
                            <ProviderKeyField
                                provider={selectedStandardSecret}
                                disabled={disabled}
                            />
                        ) : selectedCustomProvider ? (
                            <div className="flex flex-col gap-2">
                                <Typography.Text className="!text-[14.5px] !font-semibold">
                                    {selectedCustomProvider.name}
                                </Typography.Text>
                                <Typography.Text
                                    type="secondary"
                                    className="!text-xs !leading-snug"
                                >
                                    {PROVIDER_LABELS[selectedCustomProvider.provider ?? ""] ??
                                        selectedCustomProvider.provider}
                                    {" — manage this connection from Settings → Secrets."}
                                </Typography.Text>
                                {selectedCustomProvider.models?.length ? (
                                    <div className="flex flex-wrap gap-1">
                                        {selectedCustomProvider.models.map((m) => (
                                            <span
                                                key={m}
                                                className="rounded-full bg-[var(--ag-colorFillTertiary)] px-2 py-0.5 text-[11px] text-[var(--ag-colorTextSecondary)]"
                                            >
                                                {m}
                                            </span>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <Typography.Text type="secondary" className="!text-xs !leading-snug">
                                No provider selected.
                            </Typography.Text>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default ProviderCredentialsSection
