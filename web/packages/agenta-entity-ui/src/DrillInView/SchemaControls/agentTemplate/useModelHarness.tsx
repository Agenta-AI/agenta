/**
 * useModelHarness — the Model and Permissions sections, and the Advanced section's row. One
 * hook because the model/connection state feeds both; returns each section's summary + bodies.
 * The bodies themselves live in `./sections/` (one file per section); this hook owns the state.
 * Advanced opens its own views (`views/advancedView`).
 */
import {useCallback, useEffect, useMemo} from "react"

import {customSecretsAtom, type AgentConnectionNamespace} from "@agenta/entities/secret"
import type {SchemaProperty} from "@agenta/entities/shared"
import {
    harnessCapabilitiesAtomFamily,
    harnessCatalogFailedAtom,
    retryHarnessCatalogAtom,
} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {useAtomValue, useSetAtom} from "jotai"

import {useHasFocusUnder, useIsPathVisible} from "../../../drawers/shared/FocusPathsContext"
import type {PickerSelection} from "../connectionPicker"
import {
    allowedConnectionModes,
    buildModelOptionGroups,
    composeModelValue,
    connectionFromConfig,
    harnessSupportsUserMcp,
    modelIdFromConfig,
    bareConnectionModelId,
    modelLabel,
    providerForModel,
    vaultModelGroups,
    vaultPickedProviderFamily,
    type ConnectionMode,
} from "../connectionUtils"
import {selectableHarnesses} from "../harnessMeta"
import {
    isPermissionPolicy,
    permissionPolicyLabel,
    permissionPolicyOptionsForEnum,
} from "../permissionPolicy"

import {useAdvancedParts} from "./advancedParts"
import {effectiveHarnessValue, enumLabel} from "./agentTemplateUtils"
import {useAdvancedSectionBody} from "./sections/AdvancedSectionBody"
import {modelSectionBody} from "./sections/ModelSectionBody"
import {permissionsSectionBody} from "./sections/PermissionsSectionBody"

// Shared with the chat composer's model palette so a hidden harness stays hidden everywhere.

export function useModelHarness({
    schema,
    config,
    onChange,
    disabled,
    withTooltip,
    revisionId,
    normalizeSandbox = false,
    onlyCurrentConnection = false,
}: {
    schema?: SchemaProperty | null
    config: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
    withTooltip?: boolean
    revisionId?: string | null
    /** Only the live panel owner normalizes; mounting a section body never does. */
    normalizeSandbox?: boolean
    /** The picker lists only the stored connection's models (a model it no longer offers). */
    onlyCurrentConnection?: boolean
}) {
    const t = useT(modelHarnessCatalog)
    const props = (schema?.properties ?? {}) as Record<string, SchemaProperty>
    const subProps = useCallback(
        (section: string): Record<string, SchemaProperty> =>
            (props[section]?.properties as Record<string, SchemaProperty>) ?? {},
        [props],
    )
    const harnessProps = subProps("harness")
    const runnerProps = subProps("runner")

    const asObject = useCallback(
        (key: string): Record<string, unknown> =>
            config[key] && typeof config[key] === "object" && !Array.isArray(config[key])
                ? (config[key] as Record<string, unknown>)
                : {},
        [config],
    )
    const harness = asObject("harness")
    const runner = asObject("runner")
    const advancedParts = useAdvancedParts(schema, config, revisionId ?? null)
    const {
        sandboxProps,
        sandbox,
        sandboxKind,
        shownSandboxKind,
        sandboxOptions,
        hasExecutionGroup,
    } = advancedParts.sandbox

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
    useEffect(() => {
        if (disabled || !normalizeSandbox) return
        if (sandboxOptions.some((option) => option.value === shownSandboxKind)) return
        const availableValue = sandboxOptions[0]?.value ?? null
        if (availableValue && availableValue !== sandboxKind) {
            setSection("sandbox", {...sandbox, kind: availableValue})
        }
    }, [
        disabled,
        normalizeSandbox,
        sandbox,
        sandboxOptions,
        sandboxKind,
        shownSandboxKind,
        setSection,
    ])

    // Model + credential connection (`llm`). It is ALWAYS a structured object (the harness-filtered
    // picker only ever produces one); a legacy bare string is read for display. composeModelValue
    // carries through extra keys (e.g. `extras`) so a form edit never silently drops them. The picker
    // is harness-filtered: selecting a model sets BOTH the model id and its provider, fed by the
    // `/inspect` capability map below.
    const harnessValue = effectiveHarnessValue(harness)
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

    const modeOptions = useMemo(
        () => allowedConnectionModes(capabilities, harnessValue),
        [capabilities, harnessValue],
    )

    // Vault custom_provider connections carry their own models; the harness catalog can't reach them.
    const customSecrets = useAtomValue(customSecretsAtom)

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
            namespace?: AgentConnectionNamespace | null
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
            // The namespace qualifies the slug, so it goes wherever the slug goes.
            const nextNamespace =
                patch.namespace !== undefined
                    ? patch.namespace
                    : patch.slug !== undefined || patch.modelId !== undefined
                      ? null
                      : connection.namespace
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
                    namespace: nextNamespace,
                    // The scope qualifies the slug too: kept only while the slug is kept.
                    scope:
                        patch.slug !== undefined || patch.modelId !== undefined
                            ? null
                            : connection.scope,
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
                namespace: selection.namespace,
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
        if (disabled) return
        if (modeOptions.length > 0 && !modeOptions.includes(connection.mode)) {
            writeModel({mode: modeOptions[0], slug: null})
        }
    }, [disabled, connection.mode, modeOptions, writeModel])

    // Prefer the harness catalog's label ("Sonnet") over the stored id ("sonnet"), so the summary
    // names the model the way the picker did. A connection model key is namespaced
    // ("<connection>/<deployment>/..."), which neither the catalog nor the schema knows it by, so
    // both are also asked about its bare id — the summary must read as a model name either way.
    const bareModel = modelId ? bareConnectionModelId(modelId) : null
    const modelSummary =
        [
            enumLabel(harnessProps.kind, harness.kind),
            modelLabel(capabilities, harnessValue, modelId) ??
                modelLabel(capabilities, harnessValue, bareModel) ??
                enumLabel(props.llm, bareModel),
        ]
            .filter(Boolean)
            .join(" · ") || undefined

    const hasModelOrHarness = Boolean(props.llm || harnessProps.kind)
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
    // "Policy · Allow all" — the label lives here, so the body's select can run full width.
    const runnerPermissionSummary = t("entityUi.modelHarness.policySummary", {
        policy: permissionPolicyLabel(currentRunnerPermission) ?? currentRunnerPermission,
    })

    // FOCUS (see FocusPathsContext): when a surface narrows to the properties that matter — e.g. the
    // config panel showing only what changed — a body renders only what owns one of them.
    const policyInFocus = useIsPathVisible("runner.permissions.default")
    // Hidden harness policies do not focus the model picker.
    const harnessKindInFocus = useHasFocusUnder("harness.kind")

    // Same, for the Model section body: the connection list owns both `llm.model` and the
    // `harness.kind` a picked row sets, so a change filter keeps it whenever either is in scope.
    const modelInFocus = useHasFocusUnder("llm.model")

    // Advanced shows only when one of its parts applies to the agent.
    const hasAdvanced = advancedParts.any

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

    const modelHarnessBody = modelSectionBody({
        t,
        props,
        hasInspectModels,
        modelGroups,
        modelId,
        writeModel,
        disabled,
        llmProviderConfig,
        capabilities,
        harnessList,
        harnessValue,
        connection,
        revisionId,
        onlyCurrentConnection,
        applyPickerSelection,
        retryCatalog,
        catalogUnavailable,
        modelInFocus,
        harnessKindInFocus,
    })

    const permissionsBody = permissionsSectionBody({
        t,
        runnerPermissionSchema,
        policyInFocus,
        currentRunnerPermission,
        setSection,
        runner,
        runnerPermissions,
        runnerPermissionOptions,
        disabled,
    })

    const {advancedSummary, advancedChangeBody} = useAdvancedSectionBody({
        t,
        disabled,
        withTooltip,
        hasExecutionGroup,
        sandboxProps,
        sandboxOptions,
        shownSandboxKind,
        setSection,
        sandbox,
    })

    return {
        hasModelOrHarness,
        mcpSupported,
        modelSummary,
        modelHarnessBody,
        hasAdvanced,
        hasExecutionGroup,
        hasPermissions: Boolean(runnerPermissionSchema),
        permissionsBody,
        runnerPermissionSummary,
        advancedSummary,
        advancedChangeBody,
    }
}
