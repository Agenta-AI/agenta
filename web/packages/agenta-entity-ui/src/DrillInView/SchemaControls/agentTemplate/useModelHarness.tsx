/**
 * useModelHarness — the Model & harness + Advanced sections (the panel's most stateful part). One
 * hook because the model/connection state feeds both; returns each section's summary + bodies.
 */
import {useCallback, useEffect, useMemo, useState} from "react"

import {
    customSecretsAtom,
    standardSecretsAtom,
    vaultSecretsQueryAtom,
} from "@agenta/entities/secret"
import type {SchemaProperty} from "@agenta/entities/shared"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {ConfigAccordionSection, LabeledField} from "@agenta/ui/components/presentational"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {cn} from "@agenta/ui/styles"
import {Check, Cube, Key, Lightbulb, ShieldCheck, Sparkle, Warning} from "@phosphor-icons/react"
import {Select, Typography} from "antd"
import {useAtomValue} from "jotai"

import {RailField, railInfoLabel} from "../../../drawers/shared/RailField"
import {SectionRail} from "../../../drawers/shared/SectionRail"
import {ClaudePermissionsControl} from "../ClaudePermissionsControl"
import {
    allowedConnectionModes,
    buildModelOptionGroups,
    composeModelValue,
    connectionFromConfig,
    familyFromModelId,
    harnessAllowsModel,
    modelIdFromConfig,
    namedConnectionOptions,
    providerForModel,
    vaultModelGroups,
    type ConnectionMode,
    type VaultConnectionEntry,
} from "../connectionUtils"
import {EnumSelectControl} from "../EnumSelectControl"
import {GroupedChoiceControl} from "../GroupedChoiceControl"
import {HarnessSelectControl} from "../HarnessSelectControl"
import {PiSettingsControl} from "../PiSettingsControl"
import {SandboxPermissionControl} from "../SandboxPermissionControl"

import {enumLabel} from "./agentTemplateUtils"
import ProviderKeyField from "./ProviderKeyField"
import {useBuildKit} from "./useBuildKit"

type PermissionPolicy = "allow_reads" | "allow" | "ask" | "deny"

const PERMISSION_POLICY_OPTIONS: {value: PermissionPolicy; label: string; help: string}[] = [
    {value: "allow_reads", label: "Allow reads", help: "Reads run, writes ask; default"},
    {value: "allow", label: "Allow all", help: "Every tool runs without asking"},
    {value: "ask", label: "Ask", help: "A human approves every tool call"},
    {value: "deny", label: "Deny all", help: "Every tool call is refused"},
]
const PERMISSION_POLICY_VALUES = new Set<string>(
    PERMISSION_POLICY_OPTIONS.map((option) => option.value),
)

function isPermissionPolicy(value: unknown): value is PermissionPolicy {
    return typeof value === "string" && PERMISSION_POLICY_VALUES.has(value)
}

export function useModelHarness({
    schema,
    config,
    onChange,
    disabled,
    withTooltip,
    revisionId,
    buildKitEnabledOverride,
    savedHarnessValue,
}: {
    schema?: SchemaProperty | null
    config: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
    withTooltip?: boolean
    revisionId?: string | null
    /** Draft buffer for the build-kit toggle (used by the section drawer's scoped-edit mode). */
    buildKitEnabledOverride?: {value: boolean; onChange: (value: boolean) => void}
    /**
     * The SAVED (committed) harness value, for the "Current" badge — so it marks the persisted harness
     * even while `config` holds an unsaved draft pick (the draft pick is shown by the radio, not the
     * badge). Defaults to this instance's own harness, so the live instance is unaffected.
     */
    savedHarnessValue?: string | null
}) {
    const props = (schema?.properties ?? {}) as Record<string, SchemaProperty>
    const subProps = useCallback(
        (section: string): Record<string, SchemaProperty> =>
            (props[section]?.properties as Record<string, SchemaProperty>) ?? {},
        [props],
    )
    const harnessProps = subProps("harness")
    const runnerProps = subProps("runner")
    const sandboxProps = subProps("sandbox")

    const asObject = useCallback(
        (key: string): Record<string, unknown> =>
            config[key] && typeof config[key] === "object" && !Array.isArray(config[key])
                ? (config[key] as Record<string, unknown>)
                : {},
        [config],
    )
    const harness = asObject("harness")
    const runner = asObject("runner")
    const sandbox = asObject("sandbox")

    const runnerPermissions =
        runner.permissions && typeof runner.permissions === "object"
            ? (runner.permissions as Record<string, unknown>)
            : {}
    const runnerPermissionValue = isPermissionPolicy(runnerPermissions.default)
        ? runnerPermissions.default
        : null
    const runnerPermissionSchema = (
        runnerProps.permissions?.properties as Record<string, SchemaProperty> | undefined
    )?.default

    // Replace one nested execution section (harness / runner / sandbox), leaving the rest intact.
    const setSection = useCallback(
        (key: string, sectionValue: unknown) => onChange({...config, [key]: sectionValue}),
        [config, onChange],
    )
    // Set one flat field of the agent definition (here `llm` and `tools`).
    const setAgentField = useCallback(
        (key: string, fieldValue: unknown) => onChange({...config, [key]: fieldValue}),
        [config, onChange],
    )
    const setAgentTools = useCallback(
        (tools: unknown[] | undefined) => {
            const next = {...config}
            if (tools === undefined) delete next.tools
            else next.tools = tools
            onChange(next)
        },
        [config, onChange],
    )

    // Model + credential connection (`llm`). It is ALWAYS a structured object (the harness-filtered
    // picker only ever produces one); a legacy bare string is read for display. composeModelValue
    // carries through extra keys (e.g. `extras`) so a form edit never silently drops them. The picker
    // is harness-filtered: selecting a model sets BOTH the model id and its provider, fed by the
    // `/inspect` capability map below.
    const harnessValue = typeof harness.kind === "string" ? (harness.kind as string) : null
    const isPiHarness = harnessValue === "pi_core" || harnessValue === "pi_agenta"
    const llm = config.llm
    const modelId = useMemo(() => modelIdFromConfig(llm), [llm])
    const connection = useMemo(() => connectionFromConfig(llm), [llm])

    // Harness capability map, resolved from the schema's declared `x-ag-harness-ref` on the harness
    // `kind` field (its target is the `harnesses` catalog). The ref is what opts this field into
    // catalog-driven capabilities: we only apply the map when the schema declares it, otherwise the
    // connectionUtils helpers fall back to a permissive, unfiltered picker. The catalog itself is
    // global, so the ref string also keys the atom.
    const harnessRef = (harnessProps.kind as Record<string, unknown> | undefined)?.[
        "x-ag-harness-ref"
    ]
    const harnessRefKey = typeof harnessRef === "string" && harnessRef ? harnessRef : null
    const capabilitiesFromCatalog = useAtomValue(
        useMemo(() => harnessCapabilitiesAtomFamily(harnessRefKey ?? ""), [harnessRefKey]),
    )
    const capabilities = harnessRefKey ? capabilitiesFromCatalog : null

    // The project's stored connections (read-only) for the connection picker. The transformed vault
    // list surfaces custom-provider connections as {type, name, provider}; the resolver matches a
    // named connection by that name (the slug).
    const vaultQuery = useAtomValue(vaultSecretsQueryAtom)
    const vaultSecrets = useMemo(
        () => (Array.isArray(vaultQuery.data) ? (vaultQuery.data as VaultConnectionEntry[]) : []),
        [vaultQuery.data],
    )

    const modeOptions = useMemo(
        () => allowedConnectionModes(capabilities, harnessValue),
        [capabilities, harnessValue],
    )

    // Vault custom_provider connections carry their own models; the harness catalog can't reach them.
    const customSecrets = useAtomValue(customSecretsAtom)

    // Inline credential prompt: resolve the selected model's provider family and check whether the
    // vault already holds its (standard) key. When it doesn't, the drawer surfaces a key field so the
    // user can connect it here. `providerForModel` is the same catalog lookup the model picker uses.
    const standardSecrets = useAtomValue(standardSecretsAtom)
    const providerVaultEntry = useMemo(() => {
        const family = (
            providerForModel(capabilities, harnessValue, modelId) ??
            connection.provider ??
            ""
        ).toLowerCase()
        if (!family) return null
        return (
            standardSecrets.find(
                (secret) =>
                    (secret.name ?? "").toLowerCase().replace(/_api_key$/, "") === family ||
                    (secret.title ?? "").toLowerCase() === family,
            ) ?? null
        )
    }, [standardSecrets, capabilities, harnessValue, modelId, connection.provider])
    // Only assert "needs a key" once the vault query has resolved (an array). While it's pending,
    // `standardSecretsAtom` returns the static provider catalog with empty keys, so a reload would
    // flash a false "Connect key" warning on the section, rail item, and config-panel row.
    const vaultLoaded = Array.isArray(vaultQuery.data)
    // Self-managed agents never need a vault key — the harness signs itself in.
    const providerNeedsKey =
        connection.mode !== "self_managed" &&
        vaultLoaded &&
        !!providerVaultEntry &&
        !providerVaultEntry.key

    // Model section sub-tabs (rail): pick the model vs connect its provider key. Lands on "key" when a
    // key is missing so the "Set up credentials" banner opens straight onto it; only re-forces on the
    // needs-key → true transition, so manual navigation to "Model" is respected.
    const [modelTab, setModelTab] = useState<"model" | "key">(providerNeedsKey ? "key" : "model")
    useEffect(() => {
        if (providerNeedsKey) setModelTab("key")
    }, [providerNeedsKey])

    // The "Add provider" footer + drawer come from context, same source as the completion picker.
    const {llmProviderConfig} = useDrillInUI()

    // Harness-filtered model options: the inspect catalog PLUS the vault custom_provider models,
    // so a configured Bedrock model is selectable. Empty when the harness publishes none AND the
    // vault has none — fall back to the schema's full catalog picker.
    const modelGroups = useMemo(
        () => [
            ...buildModelOptionGroups(capabilities, harnessValue),
            ...vaultModelGroups(customSecrets, capabilities, harnessValue),
        ],
        [capabilities, harnessValue, customSecrets],
    )
    const hasInspectModels = modelGroups.length > 0

    // Compose the new `config.llm` ModelRef from the current fields, overriding some. Picking a
    // model derives its provider from the harness's published groups (sets both).
    const writeModel = useCallback(
        (patch: {
            modelId?: string | null
            provider?: string | null
            mode?: ConnectionMode
            slug?: string | null
        }) => {
            const nextModelId = patch.modelId !== undefined ? patch.modelId : modelId
            // A vault-model pick reunites the model with its connection slug.
            const vaultMatch =
                patch.modelId !== undefined
                    ? customSecrets.find((s) => (s.models ?? []).includes(nextModelId ?? ""))
                    : undefined
            // Provider is always the model FAMILY — a vault match's `provider` is its DEPLOYMENT
            // kind (bedrock/…), which would fail the harness provider check.
            let nextProvider: string | null
            if (patch.provider !== undefined) {
                nextProvider = patch.provider
            } else if (patch.modelId !== undefined) {
                nextProvider = vaultMatch
                    ? familyFromModelId(nextModelId, capabilities)
                    : (providerForModel(capabilities, harnessValue, nextModelId) ??
                      connection.provider)
            } else {
                nextProvider = connection.provider
            }
            // Explicit slug wins; a vault pick auto-fills; a non-vault pick keeps the current one.
            const nextSlug =
                patch.slug !== undefined
                    ? patch.slug
                    : vaultMatch?.name
                      ? (vaultMatch.name as string)
                      : connection.slug
            setAgentField(
                "llm",
                composeModelValue({
                    modelId: nextModelId,
                    provider: nextProvider,
                    mode: patch.mode !== undefined ? patch.mode : connection.mode,
                    slug: nextSlug,
                    existing: llm,
                }),
            )
        },
        [setAgentField, modelId, connection, llm, capabilities, harnessValue, customSecrets],
    )

    // Model is deliberately NOT cleared on a harness switch that can't reach it: the compatibility
    // panel flags it instead, so the user's choice survives (Arda's call; may error at run time).

    // Reset a connection mode the new harness disallows; guarded on a non-empty option set so a
    // harness publishing no modes stays permissive. Slug is NOT normalized here (connectionOptions
    // is vault-async; an empty set mid-load would wrongly clear a valid slug).
    useEffect(() => {
        if (modeOptions.length > 0 && !modeOptions.includes(connection.mode)) {
            writeModel({mode: modeOptions[0], slug: null})
        }
    }, [connection.mode, modeOptions, writeModel])

    // Named connections selectable for the chosen provider under this harness (Agenta-managed).
    const connectionOptions = useMemo(
        () => namedConnectionOptions(vaultSecrets, capabilities, harnessValue, connection.provider),
        [vaultSecrets, capabilities, harnessValue, connection.provider],
    )

    // Claude permissions (Layer 1, Claude-only): the Claude harness's own permission knobs, the
    // first-class `harness.permissions` slice. Shown in Advanced only for the Claude harness.
    const claudePermissions = useMemo(() => {
        const perms = harness.permissions
        return perms && typeof perms === "object" ? (perms as Record<string, unknown>) : null
    }, [harness])
    const setClaudePermissions = useCallback(
        (next: Record<string, unknown>) => setSection("harness", {...harness, permissions: next}),
        [harness, setSection],
    )

    const modelSummary =
        [enumLabel(harnessProps.kind, harness.kind), enumLabel(props.llm, modelId)]
            .filter(Boolean)
            .join(" · ") || undefined

    const hasModelOrHarness = Boolean(props.llm || harnessProps.kind)
    const hasClaudePermissions = harnessValue === "claude"
    const hasPiSettings = isPiHarness
    const agentTools = useMemo(
        () => (Array.isArray(config.tools) ? (config.tools as unknown[]) : null),
        [config.tools],
    )
    const runnerPermissionOptions = useMemo(() => {
        const schemaValues = Array.isArray(runnerPermissionSchema?.enum)
            ? new Set((runnerPermissionSchema.enum as unknown[]).filter(isPermissionPolicy))
            : null
        return PERMISSION_POLICY_OPTIONS.filter(
            (option) => !schemaValues || schemaValues.has(option.value),
        ).map((option) => ({
            value: option.value,
            title: option.label,
            label: (
                <div className="flex flex-col py-0.5">
                    <span>{option.label}</span>
                    <span className="text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                        {option.help}
                    </span>
                </div>
            ),
        }))
    }, [runnerPermissionSchema])
    const currentRunnerPermission = runnerPermissionValue ?? "allow_reads"
    const runnerPermissionSummary = PERMISSION_POLICY_OPTIONS.find(
        (option) => option.value === currentRunnerPermission,
    )?.label

    // Playground-only "build kit" overlay (read-only) shown at the top of Advanced. It also flags
    // sandbox-permission keys the overlay overrides for the user's own permission control below.
    const {hasBuildKitOverlay, buildKitSection, permissionOverrideHint} = useBuildKit({
        revisionId: revisionId ?? null,
        sandboxPermissions: (sandbox.permissions as Record<string, unknown> | null) ?? null,
        disabled,
        enabledOverride: buildKitEnabledOverride,
    })

    const hasAdvanced = Boolean(
        props.llm || // Authentication lives in Advanced now
        sandboxProps.kind ||
        sandboxProps.permissions ||
        runnerProps.permissions ||
        hasClaudePermissions ||
        hasPiSettings ||
        hasBuildKitOverlay,
    )

    // The Model picker (inspect-filtered when available, else the schema catalog), as a rail row —
    // the info tooltip only applies to the inspect-filtered variant (the fallback is the full catalog).
    // The bare model control (no label). In the capabilities layout the "Model" section header carries
    // the label (matching the schedule drawer's "Name" section — title + bare input), so we render this
    // directly; the flat/no-capabilities branch wraps it in a labelled `RailField` (`modelPicker`).
    const modelControl = props.llm ? (
        hasInspectModels ? (
            <SelectLLMProviderBase
                showGroup
                options={modelGroups}
                value={modelId ?? undefined}
                onChange={(v) => writeModel({modelId: (v as string) ?? null})}
                disabled={disabled}
                placeholder="Select a model…"
                className="w-full"
                footerContent={llmProviderConfig?.footerContent}
            />
        ) : (
            <GroupedChoiceControl
                schema={
                    (props.llm?.properties as Record<string, SchemaProperty> | undefined)?.model ??
                    props.llm
                }
                value={modelId}
                onChange={(v) => writeModel({modelId: v})}
                disabled={disabled}
            />
        )
    ) : null

    const modelPicker = modelControl ? (
        <RailField
            label={
                hasInspectModels
                    ? railInfoLabel(
                          "Model",
                          "Filtered to the models this harness can reach. Selecting a model also sets its provider.",
                      )
                    : "Model"
            }
            align="center"
        >
            {modelControl}
        </RailField>
    ) : null

    // Shared version-history placeholder for the section drawers (real revision diffs are deferred).
    const versionHistorySkeleton = (
        <div>
            <div className="mb-2 flex items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-[var(--ag-c-97A4B0,#97a4b0)]">
                    Version history
                </span>
                <span className="rounded-full border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-1.5 text-[10px] text-[var(--ag-c-97A4B0,#97a4b0)]">
                    soon
                </span>
            </div>
            <div className="flex flex-col gap-2.5 opacity-50">
                {["w-[42%]", "w-[32%]", "w-[38%]"].map((widthClass, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-c-EAEFF5,#eaeff5)]" />
                        <span
                            className={cn(
                                "h-2 rounded bg-[var(--ag-c-EAEFF5,#eaeff5)]",
                                widthClass,
                            )}
                        />
                    </div>
                ))}
            </div>
        </div>
    )

    // Harness list, from the inspect capabilities map. Model compatibility is shown per-card (below).
    // GAP (tracked): harness_capabilities covers model/provider/mode/hosting only — NOT tools/skills/
    // MCP — so switching harness can silently leave unsupported tools unwarned. See design.md.
    const harnessList = capabilities ? Object.keys(capabilities) : []

    // Harness as a `[rail │ detail]` (experiment): the harness list on the rail with a model-compat dot,
    // the selected harness's providers / hosting / models + compatibility badge in the content panel.
    const selectedCaps = harnessValue ? capabilities?.[harnessValue] : null
    const selectedProviders = selectedCaps?.providers ?? []
    const selectedDeployments = selectedCaps?.deployments ?? []
    const selectedModelCount = selectedCaps
        ? Object.values(selectedCaps.models ?? {}).reduce(
              (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
              0,
          )
        : 0
    // A harness supports the model if it lists the exact id OR the model's PROVIDER family (harnesses use
    // different id namespaces; the provider is the reliable cross-harness signal on the config).
    const selectedKeepsModel =
        !modelId ||
        harnessAllowsModel(capabilities, harnessValue, modelId) ||
        (!!connection.provider && selectedProviders.includes(connection.provider))
    const selectedIsCurrent = !!harnessValue && (savedHarnessValue ?? harnessValue) === harnessValue
    const selectedHarnessLabel =
        (harnessValue ? enumLabel(harnessProps.kind, harnessValue) : null) || harnessValue

    const harnessSection = (
        <SectionRail
            disabled={disabled}
            // No per-harness status dot: a harness isn't invalid because of the model — model
            // compatibility is a property of the *model* choice, shown on the selected harness's
            // detail ("supports your model" / "model not available") and on the Model section.
            items={harnessList.map((h) => ({
                value: h,
                label: enumLabel(harnessProps.kind, h) || h,
            }))}
            value={harnessValue ?? ""}
            onChange={(h) => setSection("harness", {...harness, kind: h})}
        >
            <div className="flex flex-col gap-3 py-0.5">
                <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-sm font-medium">{selectedHarnessLabel}</span>
                    {selectedIsCurrent ? (
                        <span className="rounded-full bg-[var(--ag-colorFillSecondary)] px-2 py-0.5 text-[11px] text-[var(--ag-colorPrimary)]">
                            Current
                        </span>
                    ) : null}
                    {modelId ? (
                        <span
                            className={cn(
                                "inline-flex items-center gap-1 text-[11px]",
                                selectedKeepsModel
                                    ? "text-[var(--ag-colorSuccess)]"
                                    : "text-[var(--ag-colorWarning)]",
                            )}
                        >
                            {selectedKeepsModel ? <Check size={12} /> : <Warning size={12} />}
                            {selectedKeepsModel ? "supports your model" : "model not available"}
                        </span>
                    ) : null}
                </div>
                {selectedProviders.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                            Providers
                        </span>
                        <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                            {selectedProviders.slice(0, 4).join(" · ")}
                            {selectedProviders.length > 4
                                ? ` +${selectedProviders.length - 4}`
                                : ""}
                            {selectedModelCount ? ` · ${selectedModelCount} models` : ""}
                        </span>
                    </div>
                ) : null}
                {selectedDeployments.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                            Hosting
                        </span>
                        <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                            {selectedDeployments.join(" · ")}
                        </span>
                    </div>
                ) : null}
            </div>
        </SectionRail>
    )

    // Model & harness drawer body. With inspect capabilities: harness cards + model picker on the
    // left (each card owns its model-compat state), version history on the right — same two-panel
    // shape as the Advanced drawer. Without capabilities: the plain harness select, single column.
    // Shared Model & harness controls — rendered by both the wide drawer body and the tabs-inline body.
    const modelHarnessControls = capabilities ? (
        <>
            <ConfigAccordionSection
                size="compact"
                icon={<Cube size={15} />}
                title="Harness"
                status={harnessValue ? "complete" : "default"}
                summary={selectedHarnessLabel ?? undefined}
                summaryCollapsedOnly
            >
                <div className="flex gap-2.5 rounded-md bg-[var(--ag-colorFillQuaternary)] p-3">
                    <Lightbulb
                        size={16}
                        className="mt-0.5 shrink-0 text-[var(--ag-colorTextSecondary)]"
                    />
                    <span className="text-xs leading-relaxed text-[var(--ag-colorTextSecondary)]">
                        The harness is the runtime that executes your agent. It decides which
                        providers, hosting and connection options you can use.
                    </span>
                </div>
                {harnessSection}
            </ConfigAccordionSection>

            <ConfigAccordionSection
                size="compact"
                icon={<Sparkle size={15} />}
                title="Model & credentials"
                status={
                    !modelId || !selectedKeepsModel || providerNeedsKey ? "warning" : "complete"
                }
                summary={modelId ?? undefined}
                summaryCollapsedOnly
            >
                <SectionRail
                    disabled={disabled}
                    items={[
                        {
                            value: "model",
                            label: "Model",
                            status:
                                !modelId || !selectedKeepsModel ? ("warning" as const) : undefined,
                        },
                        {
                            value: "key",
                            label: "Provider key",
                            status: providerNeedsKey ? ("warning" as const) : undefined,
                        },
                    ]}
                    value={modelTab}
                    onChange={(v) => setModelTab(v as "model" | "key")}
                >
                    {modelTab === "model" ? (
                        <div className="flex flex-col gap-2 py-0.5">
                            {modelControl}
                            {hasInspectModels ? (
                                <Typography.Text
                                    type="secondary"
                                    className="!text-[11px] !leading-snug"
                                >
                                    Filtered to the models this harness can reach. Selecting a model
                                    also sets its provider.
                                </Typography.Text>
                            ) : null}
                        </div>
                    ) : providerVaultEntry ? (
                        <ProviderKeyField provider={providerVaultEntry} />
                    ) : (
                        <Typography.Text
                            type="secondary"
                            className="!text-[11px] !leading-snug py-0.5"
                        >
                            This model's provider is set up from the model list — use “+ Add
                            provider” there to connect its credentials.
                        </Typography.Text>
                    )}
                </SectionRail>
            </ConfigAccordionSection>
        </>
    ) : (
        <>
            {harnessProps.kind && (
                <RailField label="Harness" align="center">
                    <HarnessSelectControl
                        schema={harnessProps.kind}
                        value={(harness.kind as string | null) ?? null}
                        onChange={(v) => setSection("harness", {...harness, kind: v})}
                        withTooltip={withTooltip}
                        disabled={disabled}
                    />
                </RailField>
            )}
            {modelPicker}
            {providerNeedsKey && providerVaultEntry ? (
                <ProviderKeyField provider={providerVaultEntry} />
            ) : null}
        </>
    )

    const modelHarnessDrawerBody = capabilities ? (
        <div className="flex h-full min-h-0 gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                {modelHarnessControls}
            </div>
            <div className="w-[240px] shrink-0 overflow-y-auto">{versionHistorySkeleton}</div>
        </div>
    ) : (
        <div className="flex h-full flex-col gap-3 overflow-y-auto">{modelHarnessControls}</div>
    )

    // Trimmed body for the tabs layout: the same controls in one column, without the drawer's
    // two-panel split or side panel (which read as out-of-place chrome inside a tab).
    const modelHarnessInline = <div className="flex flex-col gap-4">{modelHarnessControls}</div>

    // Authentication (credential source) — moved out of Model & harness into Advanced. The
    // credential-source axis reads as the drawer's shared `[rail | content]`: mode toggle on the
    // left, the active mode's description + (Agenta-managed) connection picker on the right.
    const authDescription =
        connection.mode === "agenta"
            ? "Agenta supplies the credential from this project's vault — the default provider key, or a named connection you pick below."
            : "The harness signs in itself (an environment variable or a prior OAuth login). Agenta injects no credential."
    const authConnectionField =
        connection.mode === "agenta" ? (
            <LabeledField
                label="Connection"
                description="Which stored connection supplies the credential. Project default uses the project's provider key."
                withTooltip={withTooltip}
            >
                <Select<string>
                    value={connection.slug ?? "__default__"}
                    onChange={(v) => writeModel({slug: v === "__default__" ? null : (v ?? null)})}
                    options={[
                        {value: "__default__", label: "Project default"},
                        ...connectionOptions.map((o) => ({value: o.value, label: o.label})),
                    ]}
                    disabled={disabled}
                    className="w-full"
                    showSearch
                    optionFilterProp="label"
                />
            </LabeledField>
        ) : null
    const authControls = props.llm ? (
        modeOptions.length > 0 ? (
            <SectionRail
                disabled={disabled}
                items={modeOptions.map((m) => ({
                    value: m,
                    label: m === "agenta" ? "Agenta-managed" : "Self-managed",
                }))}
                value={connection.mode}
                onChange={(m) => writeModel({mode: m as ConnectionMode})}
            >
                <Typography.Text type="secondary" className="text-[11px] leading-snug">
                    {authDescription}
                </Typography.Text>
                {authConnectionField}
            </SectionRail>
        ) : (
            <div className="flex flex-col gap-2">
                <Typography.Text type="secondary" className="text-[11px] leading-snug">
                    {authDescription}
                </Typography.Text>
                {authConnectionField}
            </div>
        )
    ) : null

    // Advanced header summary: auth mode + sandbox, so the collapsed header still conveys state.
    const advancedSummary =
        [
            props.llm ? (connection.mode === "agenta" ? "Agenta-managed" : "Self-managed") : null,
            sandbox.kind ? `Sandbox: ${String(sandbox.kind)}` : null,
        ]
            .filter(Boolean)
            .join(" · ") || undefined

    // Advanced drawer body: two panels like Model & harness (settings left, version history right).
    const hasExecutionGroup = Boolean(sandboxProps.kind || sandboxProps.permissions)
    const hasPermissionsGroup = Boolean(
        runnerPermissionSchema || hasClaudePermissions || hasPiSettings,
    )
    // Shared Advanced controls, rendered by both the wide drawer body and the tabs-inline body.
    // Each group is a `ConfigAccordionSection` (the shared drawer section shell used by the trigger
    // and tools drawers); inside, configuration reads as the drawer's `[rail | content]` rhythm via
    // `SectionRail` (Authentication mode) and `RailField` (labelled control rows).
    const advancedControls = (
        <>
            {buildKitSection}

            {authControls ? (
                <ConfigAccordionSection
                    size="compact"
                    defaultOpen={false}
                    icon={<Key size={15} />}
                    title="Authentication"
                    summary={
                        props.llm
                            ? connection.mode === "agenta"
                                ? "Agenta-managed"
                                : "Self-managed"
                            : undefined
                    }
                    summaryCollapsedOnly
                >
                    <Typography.Text type="secondary" className="text-[11px] leading-snug">
                        Where the model credential comes from when this agent runs.
                    </Typography.Text>
                    {authControls}
                </ConfigAccordionSection>
            ) : null}

            {hasExecutionGroup ? (
                <ConfigAccordionSection
                    size="compact"
                    defaultOpen={false}
                    icon={<Cube size={15} />}
                    title="Execution environment"
                    summary={sandbox.kind ? `Sandbox: ${String(sandbox.kind)}` : undefined}
                    summaryCollapsedOnly
                >
                    <Typography.Text type="secondary" className="text-[11px] leading-snug">
                        Where the agent&apos;s tools and code run, and what that sandbox may touch.
                    </Typography.Text>
                    {sandboxProps.kind ? (
                        <RailField label="Sandbox" align="center">
                            <EnumSelectControl
                                schema={sandboxProps.kind}
                                value={(sandbox.kind as string | null) ?? null}
                                onChange={(v) => setSection("sandbox", {...sandbox, kind: v})}
                                withTooltip={withTooltip}
                                disabled={disabled}
                            />
                        </RailField>
                    ) : null}
                    {sandboxProps.permissions ? (
                        <>
                            {permissionOverrideHint}
                            {/* Renders its knobs as peer RailField rows (Network egress / Filesystem
                                / Enforcement) sharing this section's rail — no nested sub-form. */}
                            <SandboxPermissionControl
                                value={
                                    (sandbox.permissions as Record<string, unknown> | null) ?? null
                                }
                                onChange={(v) =>
                                    setSection("sandbox", {...sandbox, permissions: v})
                                }
                                disabled={disabled}
                            />
                        </>
                    ) : null}
                </ConfigAccordionSection>
            ) : null}

            {hasPermissionsGroup ? (
                <ConfigAccordionSection
                    size="compact"
                    defaultOpen={false}
                    icon={<ShieldCheck size={15} />}
                    title="Permissions"
                    summary={runnerPermissionSummary}
                    summaryCollapsedOnly
                >
                    <Typography.Text type="secondary" className="text-[11px] leading-snug">
                        What the agent may do on its own before it must ask.
                    </Typography.Text>
                    {runnerPermissionSchema ? (
                        <RailField label="Policy" align="center">
                            <Select<PermissionPolicy>
                                value={currentRunnerPermission}
                                onChange={(v) =>
                                    setSection("runner", {
                                        ...runner,
                                        permissions: {...runnerPermissions, default: v},
                                    })
                                }
                                options={runnerPermissionOptions}
                                optionLabelProp="title"
                                disabled={disabled}
                                className="w-full"
                            />
                        </RailField>
                    ) : null}
                    {hasClaudePermissions ? (
                        <>
                            {/* Caption then peer rail rows (mode / allow / ask / deny) sharing the
                                section rail — the control renders its own RailField rows. */}
                            <span className="w-fit rounded-full bg-[var(--ant-color-fill-secondary)] px-2 text-[10px] text-[var(--ant-color-primary-text)]">
                                Claude harness
                            </span>
                            <ClaudePermissionsControl
                                value={claudePermissions}
                                onChange={setClaudePermissions}
                                disabled={disabled}
                                // Mode options + labels come from the harness `permissions`
                                // sub-schema (`default_mode` enum) so they follow the template.
                                modeSchema={
                                    (
                                        harnessProps.permissions?.properties as
                                            | Record<string, SchemaProperty>
                                            | undefined
                                    )?.default_mode
                                }
                            />
                        </>
                    ) : null}
                    {hasPiSettings ? (
                        <>
                            <span className="w-fit rounded-full bg-[var(--ant-color-fill-secondary)] px-2 text-[10px] text-[var(--ant-color-primary-text)]">
                                Pi harness
                            </span>
                            <PiSettingsControl
                                tools={agentTools}
                                onChange={setAgentTools}
                                disabled={disabled}
                            />
                        </>
                    ) : null}
                </ConfigAccordionSection>
            ) : null}
        </>
    )

    // The stacked sections carry their own dividers; drop the trailing one on whichever section
    // renders last (they're conditional, so target the last child rather than a fixed section).
    const advancedDrawerBody = (
        <div className="flex h-full min-h-0 gap-6">
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pr-1 [&>*:last-child]:!border-b-0">
                {advancedControls}
            </div>
            <div className="w-[240px] shrink-0 overflow-y-auto">{versionHistorySkeleton}</div>
        </div>
    )

    // Trimmed body for the tabs layout: the grouped controls in one column, no side panel.
    const advancedInline = (
        <div className="flex flex-col [&>*:last-child]:!border-b-0">{advancedControls}</div>
    )

    return {
        hasModelOrHarness,
        // The selected model's provider has a standard vault slot but no key yet — the config panel
        // highlights the Model & harness section and the chat gates on it until it's connected.
        needsProviderKey: providerNeedsKey,
        // A model is selected but the chosen harness can't run it — a *model* problem (the harness
        // itself stays valid), so the config panel flags the Model & harness section as invalid.
        modelUnsupported: !!modelId && !selectedKeepsModel,
        modelSummary,
        modelHarnessDrawerBody,
        modelHarnessInline,
        // The capability-aware (two-panel) drawer is wider than the plain one.
        modelHarnessDrawerWidth: capabilities ? 880 : 560,
        hasAdvanced,
        advancedSummary,
        advancedDrawerBody,
        advancedInline,
    }
}
