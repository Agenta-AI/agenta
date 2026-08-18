/**
 * useModelHarness — the Model + Advanced sections (the panel's most stateful part). One
 * hook because the model/connection state feeds both; returns each section's summary + bodies.
 */
import {useCallback, useEffect, useMemo, type ReactNode} from "react"

import {
    customSecretsAtom,
    standardSecretsAtom,
    vaultSecretsQueryAtom,
} from "@agenta/entities/secret"
import type {SchemaProperty} from "@agenta/entities/shared"
import {
    harnessCapabilitiesAtomFamily,
    harnessCatalogFailedAtom,
    retryHarnessCatalogAtom,
} from "@agenta/entities/workflow"
import {getEnabledSandboxProviders} from "@agenta/shared/api"
import {normalizeProviderFamily} from "@agenta/shared/utils"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {Cube, ShieldCheck} from "@phosphor-icons/react"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {useHasChangedUnder, useRevertUnder} from "../../../drawers/shared/ChangedPathsContext"
import {useFocusPaths, useHasFocusUnder} from "../../../drawers/shared/FocusPathsContext"
import {RailField} from "../../../drawers/shared/RailField"
import {ClaudePermissionsControl} from "../ClaudePermissionsControl"
import type {PickerSelection} from "../connectionPicker"
import {
    allowedConnectionModes,
    buildModelOptionGroups,
    composeModelValue,
    connectionFromConfig,
    harnessAllowsModel,
    harnessSupportsUserMcp,
    modelIdFromConfig,
    modelLabel,
    providerForModel,
    vaultModelGroups,
    vaultPickedProviderFamily,
    type ConnectionMode,
} from "../connectionUtils"
import {EnumSelectControl, getEnumOptions} from "../EnumSelectControl"
import {GroupedChoiceControl} from "../GroupedChoiceControl"
import {selectableHarnesses} from "../harnessMeta"
import {
    isPermissionPolicy,
    permissionPolicyLabel,
    permissionPolicyOptionsForEnum,
} from "../permissionPolicy"
import {PiPermissionsControl} from "../PiPermissionsControl"
import {SandboxPermissionControl} from "../SandboxPermissionControl"

import {effectiveHarnessValue, enumLabel} from "./agentTemplateUtils"
import {CatalogUnavailableNotice} from "./CatalogUnavailableNotice"
import ModelPickerControl from "./ModelPickerControl"
import {PermissionPolicySelect} from "./PermissionPolicySelect"
import {RevertGroupButton} from "./RevertGroupButton"
import {useBuildKit} from "./useBuildKit"

// Only assert "needs a key" once the vault query has resolved (an array). While it's pending,
// `standardSecretsAtom` returns the static provider catalog with empty keys, so a reload would
// flash a false "Connect key" warning on the section, rail item, and config-panel row.
const vaultLoadedAtom = atom((get) => Array.isArray(get(vaultSecretsQueryAtom).data))

// Shared with the chat composer's model palette so a hidden harness stays hidden everywhere.

export function useModelHarness({
    schema,
    config,
    onChange,
    disabled,
    withTooltip,
    revisionId,
    buildKitEnabledOverride,
}: {
    schema?: SchemaProperty | null
    config: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
    withTooltip?: boolean
    revisionId?: string | null
    /** Draft buffer for the build-kit toggle (used by the section drawer's scoped-edit mode). */
    buildKitEnabledOverride?: {value: boolean; onChange: (value: boolean) => void}
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
    const sandboxOptions = useMemo(() => {
        const enabled = new Set(getEnabledSandboxProviders())
        return getEnumOptions(sandboxProps.kind).filter((o) => enabled.has(o.value))
    }, [sandboxProps.kind])

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
    // Set one flat field of the agent definition (here `llm`).
    const setAgentField = useCallback(
        (key: string, fieldValue: unknown) => onChange({...config, [key]: fieldValue}),
        [config, onChange],
    )
    const sandboxValue = typeof sandbox.kind === "string" ? sandbox.kind : null
    useEffect(() => {
        const availableValue = sandboxOptions.some((option) => option.value === sandboxValue)
            ? sandboxValue
            : (sandboxOptions[0]?.value ?? null)
        if (availableValue && availableValue !== sandboxValue) {
            setSection("sandbox", {...sandbox, kind: availableValue})
        }
    }, [sandbox, sandboxOptions, sandboxValue, setSection])

    // Model + credential connection (`llm`). It is ALWAYS a structured object (the harness-filtered
    // picker only ever produces one); a legacy bare string is read for display. composeModelValue
    // carries through extra keys (e.g. `extras`) so a form edit never silently drops them. The picker
    // is harness-filtered: selecting a model sets BOTH the model id and its provider, fed by the
    // `/inspect` capability map below.
    const harnessValue = effectiveHarnessValue(harness)
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
    const catalogFailed = useAtomValue(harnessCatalogFailedAtom)
    const retryCatalog = useSetAtom(retryHarnessCatalogAtom)
    // The schema asked for the catalog and we could not fetch it: say so instead of silently
    // falling through to the pre-catalog controls, which look like an old build.
    const catalogUnavailable = Boolean(harnessRefKey) && !capabilities && catalogFailed
    const mcpSupported = harnessSupportsUserMcp(capabilities, harnessValue)

    // Narrowed to the loaded flag (all this hook reads) — the raw query atom churns identity on
    // every fetch-state flip during boot.
    const vaultLoaded = useAtomValue(vaultLoadedAtom)

    const modeOptions = useMemo(
        () => allowedConnectionModes(capabilities, harnessValue),
        [capabilities, harnessValue],
    )

    // Vault custom_provider connections carry their own models; the harness catalog can't reach them.
    const customSecrets = useAtomValue(customSecretsAtom)

    // Inline credential prompt: resolve the selected model's provider family and check whether the
    // vault already holds its (standard) key. When it doesn't, the drawer surfaces a key field so the
    // user can connect it here. `providerForModel` is the same catalog lookup the model picker uses.
    // Also fed to the Provider credentials section, which auto-highlights this family in its rail.
    const standardSecrets = useAtomValue(standardSecretsAtom)
    const selectedProviderFamily = useMemo(
        () => providerForModel(capabilities, harnessValue, modelId) ?? connection.provider ?? null,
        [capabilities, harnessValue, modelId, connection.provider],
    )
    const providerVaultEntry = useMemo(() => {
        const family = normalizeProviderFamily(selectedProviderFamily)
        if (!family) return null
        return (
            standardSecrets.find(
                (secret) =>
                    normalizeProviderFamily((secret.name ?? "").replace(/_api_key$/i, "")) ===
                        family || normalizeProviderFamily(secret.title) === family,
            ) ?? null
        )
    }, [standardSecrets, selectedProviderFamily])
    // Self-managed agents never need a vault key — the harness signs itself in. Neither does a
    // named custom-provider connection (agenta mode with a slug): it carries its own credentials,
    // so a missing STANDARD vault key for the family is not this connection's problem.
    const providerNeedsKey =
        connection.mode !== "self_managed" &&
        !(connection.mode === "agenta" && !!connection.slug) &&
        vaultLoaded &&
        !!providerVaultEntry &&
        !providerVaultEntry.key

    // The "Add custom provider" footer + drawer come from context, same source as the completion picker.
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
            /** A vault-hosted option's own connection kind (`metadata.provider` from
             * `vaultModelGroups`) — a fallback family source, see `vaultPickedProviderFamily`. */
            metadataProvider?: string | null
        }) => {
            const nextModelId = patch.modelId !== undefined ? patch.modelId : modelId
            // Explicit slug wins — the picker threads a vault option's own connection slug through
            // (see the `SelectLLMProviderBase` onChange below), so we never guess the connection by
            // model id (duplicate ids can exist across providers/connections). A model switch with
            // no explicit slug CLEARS the old one rather than keeping it: the backend fails loud on
            // a provider/slug mismatch when the new model is a standard catalog provider.
            const nextSlug =
                patch.slug !== undefined
                    ? patch.slug
                    : patch.modelId !== undefined
                      ? null
                      : connection.slug
            // Provider is always the model FAMILY — a vault connection's own `provider` is its
            // DEPLOYMENT kind (bedrock/…), which would fail the harness provider check, so
            // `vaultPickedProviderFamily` resolves the family from the id, the kind, or the driving
            // harness. A MODEL SWITCH never inherits the outgoing model's family: an unresolved
            // family writes none, because a wrong provider fails the run where a missing one lets
            // the vault record speak for itself.
            let nextProvider: string | null
            if (patch.provider !== undefined) {
                nextProvider = patch.provider
            } else if (patch.modelId !== undefined) {
                nextProvider = patch.slug
                    ? vaultPickedProviderFamily(
                          nextModelId,
                          patch.metadataProvider,
                          capabilities,
                          harnessValue,
                      )
                    : providerForModel(capabilities, harnessValue, nextModelId)
            } else {
                nextProvider = connection.provider
            }
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
        [setAgentField, modelId, connection, llm, capabilities, harnessValue],
    )

    // A picked connection row carries its model, provider family, connection and harness. All four
    // land in ONE `onChange`: writing `llm` and `harness` through two calls would have the second
    // overwrite the first, since both compose from the same (stale) `config`.
    //
    // The provider comes from the PICK alone — never from the config being replaced. A row whose
    // family cannot be resolved writes none: keeping the previous model's family would persist a
    // connection contradicting it (a Bedrock pick under Claude Code carrying a leftover
    // "openrouter"), which the server rejects on the resolved (provider, deployment) pair.
    const applyPickerSelection = useCallback(
        (selection: PickerSelection) => {
            const nextHarness = selection.harness ?? harnessValue
            const nextLlm = composeModelValue({
                modelId: selection.modelId,
                provider:
                    selection.provider ??
                    providerForModel(capabilities, nextHarness, selection.modelId),
                mode: selection.mode,
                slug: selection.slug,
                existing: llm,
            })
            onChange({
                ...config,
                llm: nextLlm,
                ...(nextHarness && nextHarness !== harnessValue
                    ? {harness: {...harness, kind: nextHarness}}
                    : {}),
            })
        },
        [capabilities, config, connection.provider, harness, harnessValue, llm, onChange],
    )

    // Model is deliberately NOT cleared on a harness switch that can't reach it: the compatibility
    // panel flags it instead, so the user's choice survives (Arda's call; may error at run time).

    // Reset a connection mode the new harness disallows; guarded on a non-empty option set so a
    // harness publishing no modes stays permissive.
    useEffect(() => {
        if (modeOptions.length > 0 && !modeOptions.includes(connection.mode)) {
            writeModel({mode: modeOptions[0], slug: null})
        }
    }, [connection.mode, modeOptions, writeModel])

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

    // Prefer the harness catalog's label ("Sonnet") over the stored id ("sonnet"), so the summary
    // names the model the way the picker did.
    const modelSummary =
        [
            enumLabel(harnessProps.kind, harness.kind),
            modelLabel(capabilities, harnessValue, modelId) ?? enumLabel(props.llm, modelId),
        ]
            .filter(Boolean)
            .join(" · ") || undefined

    const hasModelOrHarness = Boolean(props.llm || harnessProps.kind)
    const hasClaudePermissions = harnessValue === "claude"
    const hasPiPermissions = isPiHarness
    // Shared with the composer's `/permissions` palette, so the two lists cannot drift.
    const runnerPermissionOptions = useMemo(
        () =>
            permissionPolicyOptionsForEnum(runnerPermissionSchema?.enum).map((option) => ({
                value: option.value,
                title: option.label,
                help: option.help,
            })),
        [runnerPermissionSchema],
    )
    const currentRunnerPermission = runnerPermissionValue ?? "allow_reads"
    const runnerPermissionSummary = permissionPolicyLabel(currentRunnerPermission)

    // Playground-only "build kit" overlay (read-only) shown at the top of Advanced. It also flags
    // sandbox-permission keys the overlay overrides for the user's own permission control below.
    const {hasBuildKitOverlay, buildKitSection, permissionOverrideHint} = useBuildKit({
        revisionId: revisionId ?? null,
        sandboxPermissions: (sandbox.permissions as Record<string, unknown> | null) ?? null,
        disabled,
        enabledOverride: buildKitEnabledOverride,
    })

    // Which Advanced sub-sections own an uncommitted change (see `ChangedPathsProvider`). Drives
    // `defaultOpen` so a drawer opened from a "something changed" indicator lands with the changed
    // group ALREADY expanded instead of three closed rows. Mount-time is the right moment:
    // `SectionDrawer` uses `destroyOnClose`, so this re-evaluates on every open.
    const sandboxChanged = useHasChangedUnder("sandbox")
    const runnerChanged = useHasChangedUnder("runner")
    // Only `harness.permissions` belongs to this group — `harness.kind` is the Model
    // section's, so a harness selection must not light the Permissions header (or its group-revert).
    const harnessPermsChanged = useHasChangedUnder("harness.permissions")
    const permissionsChanged = runnerChanged || harnessPermsChanged
    const changedIndicator = (changed: boolean) =>
        changed ? ({tone: "draft", tooltip: "Unsaved changes in this group."} as const) : undefined

    // Section-scoped undo: restore every changed property in this group to its committed value. The
    // per-row dot reverts ONE property; this is "undo the whole group". Null when nothing changed or
    // the surface offers no revert, so the header keeps its normal actions.
    const revertSandbox = useRevertUnder("sandbox")
    const revertRunner = useRevertUnder("runner")
    const revertHarnessPerms = useRevertUnder("harness.permissions")
    const revertPermissions = useCallback(() => {
        revertRunner?.()
        revertHarnessPerms?.()
    }, [revertRunner, revertHarnessPerms])

    // Confirmed — see `RevertGroupButton`, which owns the confirm step.
    const revertAction = (onRevert: (() => void) | null) =>
        onRevert ? <RevertGroupButton onConfirm={onRevert} disabled={disabled} /> : undefined

    // FOCUS (see FocusPathsContext): when a surface narrows to the properties that matter — e.g. the
    // config panel showing only what changed — a group renders only if it owns one of them, and the
    // rows filter themselves. Chrome follows the content: with changes in ONE group there is nothing
    // to disambiguate, so it renders FLAT (just the controls, like the Connect-key field); spread
    // across several, the group headers earn their keep by saying which change belongs where.
    const focus = useFocusPaths()
    const sandboxInFocus = useHasFocusUnder("sandbox")
    const runnerInFocus = useHasFocusUnder("runner")
    // Split like the changed/revert side: harness.kind focuses the Model section,
    // harness.permissions the Permissions group — so neither pulls the other into focus.
    const harnessKindInFocus = useHasFocusUnder("harness.kind")
    const harnessPermsInFocus = useHasFocusUnder("harness.permissions")
    const permissionsInFocus = runnerInFocus || harnessPermsInFocus
    const focusedGroupCount = (sandboxInFocus ? 1 : 0) + (permissionsInFocus ? 1 : 0)
    const flatFocus = focus.active && focusedGroupCount <= 1

    // Same, for the Model section body: the connection list owns both `llm.model` and the
    // `harness.kind` a picked row sets, so a change filter keeps it whenever either is in scope.
    const modelInFocus = useHasFocusUnder("llm.model")

    const hasAdvanced = Boolean(
        sandboxProps.kind ||
        sandboxProps.permissions ||
        runnerProps.permissions ||
        hasClaudePermissions ||
        hasPiPermissions ||
        hasBuildKitOverlay,
    )

    // Harness list, from the inspect capabilities map. Model compatibility is shown per-card
    // (below); the model picker also needs it, to cross each connection with the harnesses that
    // may drive it.
    // GAP (tracked): harness_capabilities covers model/provider/mode/hosting only — NOT tools/skills/
    // MCP — so switching harness can silently leave unsupported tools unwarned. See design.md.
    const schemaHarnesses = Array.isArray(harnessProps.kind?.enum)
        ? (harnessProps.kind.enum as unknown[]).map(String)
        : []
    const harnessList = useMemo(
        () => selectableHarnesses(capabilities ? Object.keys(capabilities) : schemaHarnesses),

        [capabilities, schemaHarnesses.join(",")],
    )

    // The Model picker (inspect-filtered when available, else the schema catalog), as a rail row —
    // the info tooltip only applies to the inspect-filtered variant (the fallback is the full catalog).
    // The bare model control (no label). In the capabilities layout the "Model" section header carries
    // the label (matching the schedule drawer's "Name" section — title + bare input), so we render this
    // directly; the flat/no-capabilities branch wraps it in a labelled `RailField` (`modelPicker`).
    // The pre-connections menu: the harness's own catalog grouped by provider family, plus the
    // vault's custom-provider models. It stays as the fallback for a backend that publishes no
    // capabilities, and for a project whose connections yield no rows.
    const catalogModelControl = props.llm ? (
        hasInspectModels ? (
            <SelectLLMProviderBase
                showGroup
                providerDropdownWidth={580}
                options={modelGroups}
                value={modelId ?? undefined}
                onChange={(v, option) => {
                    // A vault-hosted model option carries its own connection slug + kind in
                    // `metadata` (set by `vaultModelGroups`); a catalog option carries neither.
                    // Read them straight off the picked option instead of re-guessing the
                    // connection by model id — duplicate ids across providers/connections would
                    // resolve to the wrong one. The kind is a fallback provider source only (see
                    // `vaultPickedProviderFamily`) for ids that encode no family themselves.
                    const picked = Array.isArray(option) ? option[0] : option
                    const metadata = (
                        picked as
                            | {metadata?: {connectionSlug?: string; provider?: string}}
                            | undefined
                    )?.metadata
                    writeModel({
                        modelId: (v as string) ?? null,
                        slug: metadata?.connectionSlug ?? null,
                        metadataProvider: metadata?.provider ?? null,
                    })
                }}
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

    // Connection-first cascade: level 1 is one row per connection (and per subscription), level 2
    // that connection's models flat, one row per model AND harness pair. Picking one writes model,
    // provider, connection and harness together, which is why this section has no harness control.
    const modelControl = props.llm ? (
        <ModelPickerControl
            capabilities={capabilities}
            harnessIds={harnessList}
            harness={harnessValue}
            modelId={modelId}
            mode={connection.mode}
            slug={connection.slug ?? null}
            disabled={disabled}
            // A subscription is a login mounted into the deployment; cloud has nowhere to mount one.
            // isCloud is really isEE today, which would hide subscriptions on self-hosted EE,
            // exactly where mounted logins exist. Ungated until a real cloud signal exists.
            showSubscriptions={true}
            onSelect={applyPickerSelection}
            fallback={catalogModelControl}
        />
    ) : null

    // The harness is no longer chosen here — each model row carries its own — so the section shows
    // no harness control. What survives is the compatibility check behind the section's badge.
    const selectedCaps = harnessValue ? capabilities?.[harnessValue] : null
    const selectedProviders = selectedCaps?.providers ?? []
    // A harness supports the model if it lists the exact id OR the model's PROVIDER family (harnesses use
    // different id namespaces; the provider is the reliable cross-harness signal on the config).
    const selectedKeepsModel =
        !modelId ||
        harnessAllowsModel(
            capabilities,
            harnessValue,
            modelId,
            customSecrets,
            connection.slug || null,
        ) ||
        (!!connection.provider && selectedProviders.includes(connection.provider))

    // The Model section's body: the picker, and nothing else. It carries no rail label — that would
    // only restate the section title and cost the narrow panel its label gutter. A focus filter
    // keeps it as long as either property it owns is in scope: the model, or the harness a picked
    // row sets.
    const catalogUnavailableNotice = <CatalogUnavailableNotice onRetry={() => retryCatalog()} />

    const modelHarnessControls = (
        <>
            {!capabilities && catalogUnavailable ? catalogUnavailableNotice : null}
            {modelInFocus || harnessKindInFocus ? modelControl : null}
        </>
    )

    // Single column: the list owns the drawer's full width.
    const modelHarnessBody = (
        <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
            {modelHarnessControls}
        </div>
    )

    // Advanced header summary: sandbox only — the connection mode now comes with the picked model.
    const advancedSummary = sandbox.kind ? `Sandbox: ${String(sandbox.kind)}` : undefined

    const hasExecutionGroup = Boolean(sandboxProps.kind || sandboxProps.permissions)
    const hasPermissionsGroup = Boolean(
        runnerPermissionSchema || hasClaudePermissions || hasPiPermissions,
    )
    // Shared Advanced controls, rendered by both the wide drawer body and the tabs-inline body.
    // Each group is a `ConfigAccordionSection` (the shared drawer section shell used by the trigger
    // and tools drawers); inside, configuration reads as the drawer's `[rail | content]` rhythm via
    // `RailField` (labelled control rows).
    /**
     * One Advanced group. Under a focus filter it disappears unless it owns a focused property, and
     * drops its chrome entirely when it's the only survivor — the body (the real controls) is the
     * same either way, so nothing is rendered twice.
     */
    const advancedGroup = (
        opts: {
            inFocus: boolean
            defaultOpen: boolean
            indicator: ReturnType<typeof changedIndicator>
            extra: ReactNode
            icon: ReactNode
            title: string
            summary?: string
            caption: ReactNode
        },
        body: ReactNode,
    ) => {
        if (!opts.inFocus) return null
        // Flat: just the focused control(s) — the group header would only restate the section.
        if (flatFocus) return <div className="flex flex-col gap-3">{body}</div>
        return (
            <ConfigAccordionSection
                size="compact"
                defaultOpen={opts.defaultOpen}
                indicator={opts.indicator}
                extra={opts.extra}
                icon={opts.icon}
                title={opts.title}
                summary={opts.summary}
                summaryCollapsedOnly
            >
                {opts.caption}
                {body}
            </ConfigAccordionSection>
        )
    }

    const executionBody = (
        <>
            {sandboxProps.kind ? (
                <RailField label="Sandbox" align="center" path="sandbox.kind">
                    <EnumSelectControl
                        schema={sandboxProps.kind}
                        options={sandboxOptions}
                        value={(sandbox.kind as string | null) ?? null}
                        onChange={(v) => setSection("sandbox", {...sandbox, kind: v})}
                        withTooltip={withTooltip}
                        disabled={disabled}
                    />
                </RailField>
            ) : null}
            {sandboxProps.permissions && sandbox.kind !== "local" ? (
                <>
                    {focus.active ? null : permissionOverrideHint}
                    {/* Renders its knobs as peer RailField rows (Network egress / Filesystem
                        / Enforcement) sharing this section's rail — no nested sub-form. */}
                    <SandboxPermissionControl
                        value={(sandbox.permissions as Record<string, unknown> | null) ?? null}
                        onChange={(v) => setSection("sandbox", {...sandbox, permissions: v})}
                        disabled={disabled}
                    />
                </>
            ) : null}
        </>
    )

    const permissionsBody = (
        <>
            {runnerPermissionSchema ? (
                <RailField label="Policy" align="center" path="runner.permissions.default">
                    <PermissionPolicySelect
                        value={currentRunnerPermission}
                        onChange={(v) =>
                            setSection("runner", {
                                ...runner,
                                permissions: {...runnerPermissions, default: v},
                            })
                        }
                        options={runnerPermissionOptions}
                        disabled={disabled}
                        aria-label="Policy"
                    />
                </RailField>
            ) : null}
            {hasClaudePermissions ? (
                <>
                    {/* Caption then peer rail rows (mode / allow / ask / deny) sharing the
                        section rail — the control renders its own RailField rows. */}
                    {focus.active ? null : (
                        <span className="w-fit rounded-full bg-[var(--ant-color-fill-secondary)] px-2 text-[12px] text-[var(--ant-color-primary-text)]">
                            Claude harness
                        </span>
                    )}
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
            {hasPiPermissions ? (
                <>
                    {focus.active ? null : (
                        <span className="w-fit rounded-full bg-[var(--ant-color-fill-secondary)] px-2 text-[12px] text-[var(--ant-color-primary-text)]">
                            Pi harness
                        </span>
                    )}
                    {/* Peer rail rows (allow / ask / deny) sharing the section rail. Each
                        declares its config path, so a focus filter keeps the changed row. */}
                    <PiPermissionsControl
                        value={(harness.permissions as Record<string, unknown> | null) ?? null}
                        onChange={(permissions) => setSection("harness", {...harness, permissions})}
                        disabled={disabled}
                    />
                </>
            ) : null}
        </>
    )

    const advancedControls = (
        <>
            {/* Playground-only overlay — it owns no committed property, so a focus filter drops it. */}
            {focus.active ? null : buildKitSection}

            {hasExecutionGroup
                ? advancedGroup(
                      {
                          inFocus: sandboxInFocus,
                          defaultOpen: sandboxChanged,
                          indicator: changedIndicator(sandboxChanged),
                          extra: revertAction(revertSandbox),
                          icon: <Cube size={15} />,
                          title: "Execution environment",
                          summary: sandbox.kind ? `Sandbox: ${String(sandbox.kind)}` : undefined,
                          caption: (
                              <span className="text-xs leading-snug text-colorTextDescription">
                                  Where the agent&apos;s tools and code run, and what that sandbox
                                  may touch.
                              </span>
                          ),
                      },
                      executionBody,
                  )
                : null}

            {hasPermissionsGroup
                ? advancedGroup(
                      {
                          inFocus: permissionsInFocus,
                          defaultOpen: permissionsChanged,
                          indicator: changedIndicator(permissionsChanged),
                          extra: permissionsChanged ? revertAction(revertPermissions) : undefined,
                          icon: <ShieldCheck size={15} />,
                          title: "Permissions",
                          summary: runnerPermissionSummary,
                          caption: (
                              <span className="text-xs leading-snug text-colorTextDescription">
                                  What the agent may do on its own before it must ask.
                              </span>
                          ),
                      },
                      permissionsBody,
                  )
                : null}
        </>
    )

    // The stacked sections carry their own dividers; drop the trailing one on whichever section
    // renders last (they're conditional, so target the last child rather than a fixed section).
    const advancedDrawerBody = (
        <div className="flex h-full flex-col overflow-y-auto [&>*:last-child]:!border-b-0">
            {advancedControls}
        </div>
    )

    return {
        hasModelOrHarness,
        mcpSupported,
        // The selected model's provider has a standard vault slot but no key yet — the config panel
        // highlights the Model section and the chat gates on it until it's connected.
        needsProviderKey: providerNeedsKey,
        // A model is selected but its harness can't run it — a *model* problem, so the config panel
        // flags the Model section as invalid.
        modelUnsupported: !!modelId && !selectedKeepsModel,
        modelSummary,
        modelHarnessBody,
        // One column of connection rows; it needs no more room than the plain drawer.
        modelHarnessDrawerWidth: 560,
        hasAdvanced,
        advancedSummary,
        advancedDrawerBody,
    }
}
