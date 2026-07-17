/**
 * ProviderCredentialsSection
 *
 * The "Provider credentials" pane, rendered as a `ConfigAccordionSection` so it reads as a peer of
 * the Harness and Model sections: a segmented "Use API key" / "Use subscription" toggle (header
 * right) over either (a) a provider rail + key form, or (b) a self-managed info card. Vault
 * reads/writes
 * (standard keys) happen directly against the secret entity's atoms/hooks — only the agent draft's
 * mode flows through props, because key saves are immediate and independent of the drawer draft
 * (locked decision; design.md §3.1). Connections are always the project default: there is no named-
 * connection picker here (owner call, post-design-doc) — a picked model can still auto-fill a vault
 * connection's slug (the model picker threads a vault option's `connectionSlug` metadata into
 * `useModelHarness.writeModel`), just not through a Select.
 *
 * The rail is filtered to the selected model: its own standard provider, the configured vault
 * custom providers whose kind can host that family (`CUSTOM_PROVIDER_KIND_FAMILIES`), and "Add …"
 * rows for the remaining kinds that could. No model family = no filter (all rows show).
 *
 * Adding a new custom provider (Azure/Bedrock/Vertex AI/OpenAI-compatible) opens the host's
 * "Configure provider" drawer via `openConfigureProvider` (from `DrillInUIContext.llmProviderConfig`)
 * instead of an inline form — this package can't import the OSS drawer directly.
 *
 * Design: docs/design/connect-model-drawer/design.md §3, §7, §8.
 */
import {useEffect, useMemo, useState, type ReactNode} from "react"

import {
    CUSTOM_PROVIDER_KIND_FAMILIES,
    customSecretsAtom,
    CustomProviderKind,
    PROVIDER_LABELS,
    standardSecretsAtom,
} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"
import {normalizeProviderFamily} from "@agenta/shared/utils"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {cn} from "@agenta/ui/styles"
import {Key, Plus, Terminal} from "@phosphor-icons/react"
import {Segmented, Typography} from "antd"
import {useAtomValue} from "jotai"

import type {ConnectionMode} from "../connectionUtils"

import ProviderKeyField from "./ProviderKeyField"

const DEFAULT_SELF_HOSTING_GUIDE_URL = "https://docs.agenta.ai/self-host/quick-start"

export interface ProviderCredentialsSectionProps {
    // config — the agent draft's credential-relevant slice (config.llm.connection.mode)
    mode: ConnectionMode
    onModeChange: (mode: ConnectionMode) => void

    // routing/context — what the current model selection points at; filters + auto-highlights the rail
    selectedProviderFamily: string | null
    /** The model's named vault connection (config.llm.connection.slug), when it has one — that
     * connection's rail row wins the auto-highlight over the standard-provider match. */
    selectedConnectionSlug?: string | null

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
    /**
     * Compact/inline variant: no `ConfigAccordionSection` wrapper (no "Provider credentials" header
     * or badge — the host section already owns those) and no provider rail (the selected model
     * already fixes the provider). Just the mode toggle over the selected provider's key form or the
     * self-managed card. Used when the pane is embedded inline under another section's header.
     */
    bare?: boolean
    /** Bare variant only: the model picker node, rendered in the header row to the left of the mode
     * toggle (`[ model select ⋯ API key | Subscription ]`). */
    modelControl?: ReactNode
    /** The displayed revision, threaded to the key form so a save can raise the "API key added"
     * config-pane banner scoped to it. */
    revisionId?: string | null

    /** Uncommitted-change indicator for the section header (drawer / change surfaces) — mirrors the
     * Harness/Model sections. Ignored in the `bare` variant (it renders no section header). */
    indicator?: {tone: "draft" | "invalid" | "incomplete" | "agent"; tooltip?: ReactNode}
    /** Section-scoped revert control, rendered in the header beside the mode toggle. */
    revertControl?: ReactNode
}

const STANDARD_PREFIX = "std:"
const CUSTOM_PREFIX = "custom:"

/** The four provider kinds the "Configure provider" drawer supports beyond the standard catalog
 * (verified against `PROVIDER_FIELDS`/`CustomProviderForm`'s `customProviders` list). */
const CUSTOM_PROVIDER_ROWS: {kind: string; label: string}[] = [
    {kind: CustomProviderKind.Azure, label: "Azure OpenAI"},
    {kind: CustomProviderKind.Bedrock, label: "AWS Bedrock"},
    {kind: CustomProviderKind.VertexAi, label: "Vertex AI"},
    {kind: CustomProviderKind.Custom, label: "Custom provider"},
]

/** Family spellings that must compare equal across catalog names, vault env names, and titles. */
const FAMILY_ALIASES: Record<string, string[]> = {
    google: ["gemini", "googlegemini"],
    gemini: ["google", "googlegemini"],
    googlegemini: ["google", "gemini"],
    mistral: ["mistralai"],
    mistralai: ["mistral"],
}

function familyCandidates(family: string): Set<string> {
    return new Set([family, ...(FAMILY_ALIASES[family] ?? [])])
}

/** Same family match `useModelHarness`'s `providerVaultEntry` uses: env-var name minus the
 * `_API_KEY` suffix, or the title, case-insensitively. */
function standardSecretFamily(secret: LlmProvider): string {
    return normalizeProviderFamily((secret.name ?? "").replace(/_api_key$/i, ""))
}

function standardSecretMatches(secret: LlmProvider, candidates: Set<string>): boolean {
    return (
        candidates.has(standardSecretFamily(secret)) ||
        candidates.has(normalizeProviderFamily(secret.title))
    )
}

/** Whether a custom-provider KIND (azure/bedrock/…) can host the selected model family. Mirrors
 * connectionUtils' `harnessReachesCustomProviderKind` two-flavor split: a DEPLOYMENT kind
 * (azure/bedrock/vertex_ai/sagemaker/custom) is gated by `CUSTOM_PROVIDER_KIND_FAMILIES`, but a
 * kind absent from that map is a plain PROVIDER FAMILY (e.g. a second "openai"-kind connection) —
 * the kind itself IS the family, so it serves the selected model whenever the kind matches. Without
 * this branch the rail hides plain-family custom connections that the model dropdown still shows. */
function kindServesFamily(kind: string | null | undefined, candidates: Set<string>): boolean {
    const normalizedKind = (kind ?? "").toLowerCase()
    const families = CUSTOM_PROVIDER_KIND_FAMILIES[normalizedKind]
    if (families === "*") return true
    if (families) return families.some((family) => candidates.has(normalizeProviderFamily(family)))
    return candidates.has(normalizeProviderFamily(normalizedKind))
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
        // Fixed-light logo tile: brand glyphs are dark-filled and would vanish on dark fills.
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] border border-solid border-[var(--ag-colorBorderSecondary)] bg-white text-[10px] font-semibold text-[#586673]">
            {icon ?? (label.charAt(0).toUpperCase() || "?")}
        </span>
    )
}

/** One rail row shape for every entry (providers AND the add rows): fixed h-9, 22px logo tile,
 * one flex pattern — unselected transparent, hover subtle fill, selected filled + semibold. */
function RailRow({
    active,
    disabled,
    onClick,
    tile,
    label,
    trailing,
}: {
    active?: boolean
    disabled?: boolean
    onClick: () => void
    tile: ReactNode
    label: string
    trailing?: ReactNode
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "flex h-9 w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-[7px] border-0 bg-transparent px-2.5 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                active
                    ? "bg-[var(--ag-colorFillSecondary)] font-semibold text-[var(--ag-colorText)]"
                    : "text-[var(--ag-colorTextSecondary)] hover:bg-[var(--ag-colorFillTertiary)] hover:text-[var(--ag-colorText)]",
            )}
        >
            {tile}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {trailing}
        </button>
    )
}

/** The same rail entry laid out horizontally — a chip for the top-rail (rotated) layout. `dashed`
 * marks an "add" action (opens the Configure drawer) vs a selectable provider. */
function RailChip({
    active,
    dashed,
    disabled,
    onClick,
    tile,
    label,
    trailing,
}: {
    active?: boolean
    dashed?: boolean
    disabled?: boolean
    onClick: () => void
    tile: ReactNode
    label: string
    trailing?: ReactNode
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-solid px-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                active
                    ? "border-[var(--ag-colorBorder)] bg-[var(--ag-colorFillSecondary)] font-medium text-[var(--ag-colorText)]"
                    : cn(
                          "bg-transparent text-[var(--ag-colorTextSecondary)] hover:bg-[var(--ag-colorFillTertiary)] hover:text-[var(--ag-colorText)]",
                          dashed
                              ? "border-dashed border-[var(--ag-colorBorder)]"
                              : "border-[var(--ag-colorBorderSecondary)]",
                      ),
            )}
        >
            {tile}
            <span className="truncate">{label}</span>
            {trailing}
        </button>
    )
}

export function ProviderCredentialsSection({
    mode,
    onModeChange,
    selectedProviderFamily,
    selectedConnectionSlug,
    modeOptions,
    isCloud,
    selfHostingGuideUrl,
    providerNeedsKey,
    openConfigureProvider,
    disabled,
    bare,
    modelControl,
    revisionId,
    indicator,
    revertControl,
}: ProviderCredentialsSectionProps) {
    const standardSecrets = useAtomValue(standardSecretsAtom)
    const customSecrets = useAtomValue(customSecretsAtom)

    // The model's own named vault connection, when it has one. It always gets a rail row and wins
    // the auto-highlight — a vault model id often encodes no catalog family, so without this the
    // rail would fall back to an unrelated standard provider.
    const slugSecret = useMemo(
        () =>
            selectedConnectionSlug
                ? (customSecrets.find((secret) => secret.name === selectedConnectionSlug) ?? null)
                : null,
        [customSecrets, selectedConnectionSlug],
    )

    // Filter the rail to the selected model's family (owner rule: only the providers that can
    // serve the picked model). No family: a named vault connection narrows the rail to itself;
    // otherwise there is nothing to filter by and everything shows.
    const family = normalizeProviderFamily(selectedProviderFamily)
    const candidates = useMemo(() => (family ? familyCandidates(family) : null), [family])
    const visibleStandardSecrets = useMemo(() => {
        if (candidates)
            return standardSecrets.filter((secret) => standardSecretMatches(secret, candidates))
        return slugSecret ? [] : standardSecrets
    }, [standardSecrets, candidates, slugSecret])
    const visibleCustomSecrets = useMemo(() => {
        const base = candidates
            ? customSecrets.filter((secret) => kindServesFamily(secret.provider, candidates))
            : slugSecret
              ? [slugSecret]
              : customSecrets
        return slugSecret && !base.some((secret) => secret.name === slugSecret.name)
            ? [slugSecret, ...base]
            : base
    }, [customSecrets, candidates, slugSecret])
    const visibleAddRows = useMemo(
        () =>
            candidates
                ? CUSTOM_PROVIDER_ROWS.filter((row) => kindServesFamily(row.kind, candidates))
                : CUSTOM_PROVIDER_ROWS,
        [candidates],
    )

    // The rail row matching the agent's current provider (auto-highlight): its named vault
    // connection first, else the first visible row — the filter already reduced the standard list
    // to the selected family's entry when there is one.
    const autoKey = useMemo(() => {
        if (slugSecret?.name) return `${CUSTOM_PREFIX}${slugSecret.name}`
        const standard = visibleStandardSecrets[0]
        if (standard) return `${STANDARD_PREFIX}${standard.name}`
        const custom = visibleCustomSecrets[0]
        return custom ? `${CUSTOM_PREFIX}${custom.name}` : ""
    }, [slugSecret, visibleStandardSecrets, visibleCustomSecrets])

    // `null` = follow `autoKey`; set once the user browses another provider so browsing doesn't
    // change the agent's model (design.md §3.2).
    const [manualKey, setManualKey] = useState<string | null>(null)
    useEffect(() => {
        setManualKey(null)
    }, [selectedProviderFamily, selectedConnectionSlug])
    // A manual pick that the filter no longer shows falls back to the auto row.
    const visibleKeys = useMemo(() => {
        const keys = new Set<string>()
        for (const secret of visibleStandardSecrets) keys.add(`${STANDARD_PREFIX}${secret.name}`)
        for (const secret of visibleCustomSecrets) keys.add(`${CUSTOM_PREFIX}${secret.name}`)
        return keys
    }, [visibleStandardSecrets, visibleCustomSecrets])
    const activeKey = manualKey && visibleKeys.has(manualKey) ? manualKey : autoKey

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
                modeOptions.includes("agenta") ? {label: "API key", value: "agenta"} : null,
                modeOptions.includes("self_managed")
                    ? {label: "Subscription", value: "self_managed"}
                    : null,
            ].filter((option): option is {label: string; value: ConnectionMode} => option !== null),
        [modeOptions],
    )
    // Hidden entirely when there's nothing to toggle between (harness allows only one mode).
    const showToggle = toggleOptions.length > 1
    const guideUrl = selfHostingGuideUrl || DEFAULT_SELF_HOSTING_GUIDE_URL

    // Shared segmented styling: a subtle elevated track (not a stark black rectangle on the near-black
    // panel) with a theme-inverted selected fill (antd's default thumb resolves near-white in light
    // mode, so the active segment would be invisible). Reused by the mode + provider-type toggles.
    const segmentedClassName = cn(
        "rounded-md border border-solid border-[var(--ag-colorBorder)] !bg-[var(--ag-colorFillTertiary)]",
        "[&_.ant-segmented-item-selected]:!bg-[var(--ag-colorText)] [&_.ant-segmented-item-selected]:!text-[var(--ag-colorBgContainer)] [&_.ant-segmented-item-selected]:!shadow-none",
        "[&_.ant-segmented-thumb]:!bg-[var(--ag-colorText)] [&_.ant-segmented-thumb]:!shadow-none",
    )

    const toggle = showToggle ? (
        <Segmented
            size="small"
            value={mode}
            disabled={disabled}
            onChange={(value) => onModeChange(value as ConnectionMode)}
            options={toggleOptions}
            className={segmentedClassName}
        />
    ) : null

    const selfManagedCard = (
        <div className="flex flex-col items-start gap-3 rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)] p-4">
            <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)]">
                <Terminal size={18} className="text-[var(--ag-colorTextSecondary)]" />
            </div>
            <div className="flex flex-col gap-1">
                <Typography.Text className="!text-[13px] !font-semibold">
                    Self-managed
                </Typography.Text>
                <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4">
                    <li>
                        <Typography.Text type="secondary" className="!text-xs !leading-relaxed">
                            Use a Claude Code or Codex subscription, or any credential the harness
                            reads from its own environment (env vars, prior logins).
                        </Typography.Text>
                    </li>
                    <li>
                        <Typography.Text type="secondary" className="!text-xs !leading-relaxed">
                            Agenta stores and injects no key.
                        </Typography.Text>
                    </li>
                    <li>
                        <Typography.Text
                            type="secondary"
                            className="!text-xs !font-semibold !leading-relaxed"
                        >
                            Requires a self-hosted Agenta deployment.
                        </Typography.Text>
                    </li>
                </ul>
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
                    // fallback until colorErrorBg token lands
                    <span className="rounded-full border border-solid border-[var(--ag-colorErrorBorder)] bg-[var(--ag-colorErrorBg,rgba(255,77,79,0.12))] px-2 py-0.5 text-[11px] text-[var(--ag-colorErrorText)]">
                        Unavailable in the cloud
                    </span>
                ) : null}
            </div>
        </div>
    )

    // Read-only summary for a configured custom connection (its key edit lives in Settings → Secrets).
    const renderCustomSummary = (secret: LlmProvider) => (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
                <Typography.Text className="!text-[13px] !font-semibold">
                    {secret.name}
                </Typography.Text>
                <Typography.Text type="secondary" className="!text-xs !leading-snug">
                    {PROVIDER_LABELS[secret.provider ?? ""] ?? secret.provider}
                    {" · manage this connection in Settings → Secrets."}
                </Typography.Text>
            </div>
            {secret.models?.length ? (
                <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                        Models
                    </span>
                    <span className="text-xs leading-relaxed text-[var(--ag-colorTextSecondary)]">
                        {secret.models.join(" · ")}
                    </span>
                </div>
            ) : null}
        </div>
    )

    // The selected provider's key form (or a read-only custom-provider summary / empty note). Shared
    // by the section's master-detail pane and the bare inline variant.
    const providerDetail = selectedStandardSecret ? (
        // Keyed by provider name: ProviderKeyField's internal draft-key useState otherwise survives a
        // rail switch, letting provider A's half-typed key get saved under provider B. In the bare
        // (compact) view the selected chip already names the provider, so drop the detail header.
        <ProviderKeyField
            key={selectedStandardSecret.name}
            provider={selectedStandardSecret}
            disabled={disabled}
            hideHeader={bare}
            revisionId={revisionId}
        />
    ) : selectedCustomProvider ? (
        renderCustomSummary(selectedCustomProvider)
    ) : (
        <Typography.Text type="secondary" className="!text-xs !leading-snug">
            No provider configured for this model yet — add one from the list.
        </Typography.Text>
    )

    // Custom-provider "Use custom provider" rows (open the Configure drawer), shared by rail + compact.
    const addProviderRows =
        openConfigureProvider && visibleAddRows.length
            ? visibleAddRows.map((row) => (
                  <RailRow
                      key={row.kind}
                      disabled={disabled}
                      onClick={() => openConfigureProvider(row.kind)}
                      tile={<ProviderTile family={row.kind} label={row.label} />}
                      label={row.label}
                      trailing={
                          <Plus size={12} className="shrink-0 text-[var(--ag-colorTextTertiary)]" />
                      }
                  />
              ))
            : null

    const railDetail = (
        <div className="flex min-h-[236px] overflow-hidden rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)]">
            <div className="flex w-[190px] shrink-0 flex-col gap-0.5 overflow-y-auto border-0 border-r border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] p-2">
                {visibleStandardSecrets.map((secret) => (
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
                        trailing={
                            secret.key ? (
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
                            ) : undefined
                        }
                    />
                ))}
                {visibleCustomSecrets.map((secret) => (
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
                        trailing={
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
                        }
                    />
                ))}
                {addProviderRows ? (
                    <div className="mt-1.5 flex flex-col gap-0.5 border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] pt-1.5">
                        <span className="px-2.5 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                            Use custom provider
                        </span>
                        {addProviderRows}
                    </div>
                ) : null}
            </div>

            <div className="flex min-w-0 flex-1 flex-col p-4">{providerDetail}</div>
        </div>
    )

    // Top-rail (rotated master-detail): the same provider list as `railDetail`, but the rail runs
    // horizontally across the top and the detail (the OpenAI heading + key form) fills the width
    // below. Suits the narrow inline column, where a side rail leaves the key form cramped. Reuses
    // the shared `activeKey`/`setManualKey`/`providerDetail` so selection stays consistent.
    const topRail = (
        <div className="overflow-hidden rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)]">
            <div className="flex items-center gap-1.5 overflow-x-auto border-0 border-b border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] p-2.5 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--ag-colorFillSecondary)] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-1.5">
                {visibleStandardSecrets.map((secret) => (
                    <RailChip
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
                        trailing={
                            secret.key ? (
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
                            ) : undefined
                        }
                    />
                ))}
                {visibleCustomSecrets.map((secret) => (
                    <RailChip
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
                        trailing={
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
                        }
                    />
                ))}
                {openConfigureProvider && visibleAddRows.length
                    ? visibleAddRows.map((row) => (
                          <RailChip
                              key={row.kind}
                              dashed
                              disabled={disabled}
                              onClick={() => openConfigureProvider(row.kind)}
                              tile={<ProviderTile family={row.kind} label={row.label} />}
                              label={row.label}
                              trailing={
                                  <Plus
                                      size={12}
                                      className="shrink-0 text-[var(--ag-colorTextTertiary)]"
                                  />
                              }
                          />
                      ))
                    : null}
            </div>
            <div className="p-4">{providerDetail}</div>
        </div>
    )

    // Compact inline variant: a `[ model select ⋯ API key | Subscription ]` header row over the
    // top-rail provider strip (or the self-managed card) — no accordion header/badge; the host
    // section owns those.
    if (bare) {
        return (
            <div className="flex flex-col gap-3">
                {/* Header: model picker takes the remaining width, mode toggle sits right. */}
                {modelControl || toggle ? (
                    <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">{modelControl}</div>
                        {toggle}
                    </div>
                ) : null}
                {mode === "self_managed" ? selfManagedCard : topRail}
            </div>
        )
    }

    return (
        <ConfigAccordionSection
            size="compact"
            icon={<Key size={15} />}
            title="Provider credentials"
            status={providerNeedsKey ? "warning" : "complete"}
            indicator={indicator}
            titleBadge={
                providerNeedsKey ? (
                    <span className="rounded-full border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ag-colorWarningText)]">
                        Connect key
                    </span>
                ) : null
            }
            summary={mode === "self_managed" ? "Subscription" : "API key"}
            summaryCollapsedOnly
            noDivider
            extra={
                revertControl || toggle ? (
                    <div className="flex items-center gap-1">
                        {revertControl}
                        {toggle}
                    </div>
                ) : undefined
            }
        >
            {mode === "self_managed" ? selfManagedCard : railDetail}
        </ConfigAccordionSection>
    )
}

export default ProviderCredentialsSection
