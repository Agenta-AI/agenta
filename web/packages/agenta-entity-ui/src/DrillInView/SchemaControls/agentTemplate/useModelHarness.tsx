/**
 * useModelHarness — the Model & harness + Advanced sections (the panel's most stateful part). One
 * hook because the model/connection state feeds both; returns each section's summary + bodies.
 */
import {useCallback, useEffect, useMemo} from "react"

import {customSecretsAtom, vaultSecretsQueryAtom} from "@agenta/entities/secret"
import type {SchemaProperty} from "@agenta/entities/shared"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {
    Combobox,
    ComboboxContent,
    ComboboxInput,
    ComboboxItem,
    ComboboxTrigger,
    ComboboxValue,
} from "@agenta/primitive-ui/components/combobox"
import {ConfigAccordionSection, LabeledField} from "@agenta/ui/components/presentational"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {cn} from "@agenta/ui/styles"
import {Check, Cube, EyeSlash, Key, Lightbulb, ShieldCheck, Warning} from "@phosphor-icons/react"
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
import {SandboxPermissionControl} from "../SandboxPermissionControl"

import {enumLabel} from "./agentTemplateUtils"
import {useBuildKit} from "./useBuildKit"

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

    // The runner's headless interaction default (was the flat `permission_policy`).
    const runnerInteractions =
        runner.interactions && typeof runner.interactions === "object"
            ? (runner.interactions as Record<string, unknown>)
            : {}
    const headlessValue = (runnerInteractions.headless as string | null | undefined) ?? null
    const headlessSchema = (
        runnerProps.interactions?.properties as Record<string, SchemaProperty> | undefined
    )?.headless

    // Replace one nested execution section (harness / runner / sandbox), leaving the rest intact.
    const setSection = useCallback(
        (key: string, sectionValue: unknown) => onChange({...config, [key]: sectionValue}),
        [config, onChange],
    )
    // Set one flat field of the agent definition (here only `llm`).
    const setAgentField = useCallback(
        (key: string, fieldValue: unknown) => onChange({...config, [key]: fieldValue}),
        [config, onChange],
    )

    // Model + credential connection (`llm`). It is ALWAYS a structured object (the harness-filtered
    // picker only ever produces one); a legacy bare string is read for display. composeModelValue
    // carries through extra keys (e.g. `extras`) so a form edit never silently drops them. The picker
    // is harness-filtered: selecting a model sets BOTH the model id and its provider, fed by the
    // `/inspect` capability map below.
    const harnessValue = typeof harness.kind === "string" ? (harness.kind as string) : null
    // Pi (`pi_core`/`pi_agenta`) never gates tool use (`permissions: false`); a permission
    // policy is meaningless for it, so the field is hidden for Pi. Only Claude honors it.
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
        runnerProps.interactions ||
        hasClaudePermissions ||
        hasBuildKitOverlay,
    )

    // The Model picker (inspect-filtered when available, else the schema catalog), as a rail row —
    // the info tooltip only applies to the inspect-filtered variant (the fallback is the full catalog).
    const modelPicker = props.llm ? (
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
            {hasInspectModels ? (
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
                        (props.llm?.properties as Record<string, SchemaProperty> | undefined)
                            ?.model ?? props.llm
                    }
                    value={modelId}
                    onChange={(v) => writeModel({modelId: v})}
                    disabled={disabled}
                />
            )}
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

    const harnessCards = (
        <div className="flex flex-col gap-2">
            {harnessList.map((h) => {
                const caps = capabilities?.[h]
                // `selected` = the (draft) pick → drives the radio + border. `isCurrent` = the SAVED
                // harness → drives the "Current" badge, so the badge stays put until the draft is saved.
                const selected = harnessValue === h
                const isCurrent = (savedHarnessValue ?? harnessValue) === h
                const providers = caps?.providers ?? []
                const deployments = caps?.deployments ?? []
                const modelCount = caps
                    ? Object.values(caps.models ?? {}).reduce(
                          (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
                          0,
                      )
                    : 0
                // A harness supports the model if it lists the exact id OR the model's PROVIDER family.
                // The provider fallback matters because harnesses use different id namespaces: Claude
                // Code's short alias "opus" isn't in Pi's full-id catalog, but Pi does list the anthropic
                // provider — so it can run the model. Without this, cross-harness checks read as false
                // "model not available". (Exact-id alone still can't map aliases; the provider is the
                // reliable signal we have on the config.)
                const modelProvider = connection.provider
                const keepsModel =
                    !modelId ||
                    harnessAllowsModel(capabilities, h, modelId) ||
                    (!!modelProvider && providers.includes(modelProvider))
                return (
                    <button
                        key={h}
                        type="button"
                        disabled={disabled}
                        onClick={() => setSection("harness", {...harness, kind: h})}
                        className={cn(
                            "flex w-full flex-col gap-1.5 rounded-lg border border-solid p-2.5 text-left transition-colors",
                            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                            selected
                                ? "border-[var(--ant-color-primary-border-hover)] bg-[var(--ant-color-fill-secondary)]"
                                : "border-[var(--ant-color-border)] bg-[var(--ant-color-fill-quaternary)] hover:border-[var(--ant-color-text-quaternary)] hover:bg-[var(--ant-color-fill-tertiary)]",
                        )}
                    >
                        <div className="flex items-center gap-2">
                            <span
                                className={cn(
                                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-solid",
                                    selected
                                        ? "border-[var(--ant-color-primary)]"
                                        : "border-[var(--ant-color-text-tertiary)]",
                                )}
                            >
                                {selected && (
                                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--ant-color-primary)]" />
                                )}
                            </span>
                            <span className="text-xs font-medium">
                                {enumLabel(harnessProps.kind, h) || h}
                            </span>
                            <span className="ml-auto flex items-center gap-2">
                                {/* Model compatibility lives on the card itself: warn on the CURRENT
                                    harness when it can't run the selected model (quiet when it can);
                                    for alternatives, show whether switching would keep the model. */}
                                {modelId && (!keepsModel || !selected) ? (
                                    <span
                                        className={cn(
                                            "inline-flex items-center gap-1 text-[10.5px]",
                                            keepsModel
                                                ? "text-[var(--ant-color-success)]"
                                                : "text-[var(--ant-color-warning)]",
                                        )}
                                    >
                                        {keepsModel ? <Check size={11} /> : <Warning size={11} />}
                                        {keepsModel ? "supports your model" : "model not available"}
                                    </span>
                                ) : null}
                                {isCurrent ? (
                                    <span className="rounded-full bg-[var(--ant-color-fill-secondary)] px-2 text-[10px] text-[var(--ant-color-primary-text)]">
                                        Current
                                    </span>
                                ) : null}
                            </span>
                        </div>
                        {providers.length > 0 || modelCount > 0 ? (
                            <div className="pl-[22px] text-[11px] text-[var(--ag-c-97A4B0,#97a4b0)]">
                                {providers.slice(0, 4).join(", ")}
                                {providers.length > 4 ? ` +${providers.length - 4}` : ""}
                                {modelCount ? ` · ${modelCount} models` : ""}
                            </div>
                        ) : null}
                        {deployments.length > 0 ? (
                            <div className="pl-[22px] text-[11px] text-[var(--ag-c-97A4B0,#97a4b0)]">
                                Hosting: {deployments.join(" · ")}
                            </div>
                        ) : null}
                    </button>
                )
            })}
        </div>
    )

    // Model & harness drawer body. With inspect capabilities: harness cards + model picker on the
    // left (each card owns its model-compat state), version history on the right — same two-panel
    // shape as the Advanced drawer. Without capabilities: the plain harness select, single column.
    // Shared Model & harness controls — rendered by both the wide drawer body and the tabs-inline body.
    const modelHarnessControls = capabilities ? (
        <>
            <div className="flex gap-2 rounded-md bg-[var(--ant-color-fill-quaternary)] p-2.5">
                <Lightbulb size={15} className="mt-px shrink-0 text-[var(--ag-c-586673,#586673)]" />
                <span className="text-[11.5px] leading-snug text-[var(--ag-c-586673,#586673)]">
                    The harness is the runtime that executes your agent. It decides which providers,
                    hosting and connection options you can use.
                </span>
            </div>
            <RailField label="Harness">{harnessCards}</RailField>
            {modelPicker}
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
                <Combobox
                    value={connection.slug ?? "__default__"}
                    onValueChange={(v) =>
                        writeModel({slug: v === "__default__" ? null : (v ?? null)})
                    }
                    disabled={disabled}
                >
                    <ComboboxTrigger className="w-full">
                        <ComboboxValue placeholder="Select connection" />
                    </ComboboxTrigger>
                    <ComboboxContent>
                        <ComboboxInput placeholder="Search connections..." />
                        {[
                            {value: "__default__", label: "Project default"},
                            ...connectionOptions.map((o) => ({value: o.value, label: o.label})),
                        ].map((o) => (
                            <ComboboxItem key={o.value} value={o.value}>
                                {o.label}
                            </ComboboxItem>
                        ))}
                    </ComboboxContent>
                </Combobox>
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
                <span className="text-[11px] leading-snug text-muted-foreground">
                    {authDescription}
                </span>
                {authConnectionField}
            </SectionRail>
        ) : (
            <div className="flex flex-col gap-2">
                <span className="text-[11px] leading-snug text-muted-foreground">
                    {authDescription}
                </span>
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
    const hasPermissionsGroup = Boolean(headlessSchema || hasClaudePermissions)
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
                    <span className="text-[11px] leading-snug text-muted-foreground">
                        Where the model credential comes from when this agent runs.
                    </span>
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
                    <span className="text-[11px] leading-snug text-muted-foreground">
                        Where the agent&apos;s tools and code run, and what that sandbox may touch.
                    </span>
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
                    summary="Auto"
                    summaryCollapsedOnly
                >
                    <span className="text-[11px] leading-snug text-muted-foreground">
                        What the agent may do on its own before it must ask.
                    </span>
                    {headlessSchema ? (
                        <RailField label="Policy" align="center">
                            {isPiHarness ? (
                                <span className="flex items-center gap-1.5 text-[11px] text-[var(--ag-colorTextTertiary)]">
                                    <EyeSlash size={13} />
                                    Permission policy isn&apos;t used by the Pi harness.
                                </span>
                            ) : (
                                <EnumSelectControl
                                    schema={headlessSchema}
                                    value={headlessValue}
                                    onChange={(v) =>
                                        setSection("runner", {
                                            ...runner,
                                            interactions: {...runnerInteractions, headless: v},
                                        })
                                    }
                                    withTooltip={withTooltip}
                                    disabled={disabled}
                                />
                            )}
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
