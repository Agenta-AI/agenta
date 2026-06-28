/**
 * useModelHarness — the Model & harness + Advanced sections (the panel's most stateful part). One
 * hook because the model/connection state feeds both; returns each section's summary + bodies.
 */
import {useCallback, useEffect, useMemo, useState} from "react"

import {vaultSecretsQueryAtom} from "@agenta/entities/secret"
import type {SchemaProperty} from "@agenta/entities/shared"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {LabeledField} from "@agenta/ui/components/presentational"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {cn} from "@agenta/ui/styles"
import {Check, Cube, EyeSlash, Key, Lightbulb, ShieldCheck, Warning} from "@phosphor-icons/react"
import {Select, Switch, Typography} from "antd"
import {useAtomValue} from "jotai"

import {ClaudePermissionsControl} from "../ClaudePermissionsControl"
import {CodeEditor} from "../CodeEditor"
import {
    allowedConnectionModes,
    buildModelOptionGroups,
    composeModelValue,
    connectionFromConfig,
    harnessAllowsModel,
    modelIdFromConfig,
    namedConnectionOptions,
    providerForModel,
    type ConnectionMode,
    type VaultConnectionEntry,
} from "../connectionUtils"
import {EnumSelectControl} from "../EnumSelectControl"
import {GroupedChoiceControl} from "../GroupedChoiceControl"
import {HarnessSelectControl} from "../HarnessSelectControl"
import {SandboxPermissionControl} from "../SandboxPermissionControl"

import {enumLabel} from "./agentTemplateUtils"

export function useModelHarness({
    schema,
    config,
    onChange,
    revisionId,
    disabled,
    withTooltip,
}: {
    schema?: SchemaProperty | null
    config: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    revisionId: string | null
    disabled?: boolean
    withTooltip?: boolean
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

    // Per-harness capability map from the `/inspect` response meta, keyed by the open revision.
    // Null when inspect hasn't resolved or the agent didn't publish it (older agents / standalone),
    // in which case the connectionUtils helpers fall back permissively.
    const capabilities = useAtomValue(
        useMemo(() => harnessCapabilitiesAtomFamily(revisionId ?? ""), [revisionId]),
    )

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

    // Harness-filtered model options, built straight from inspect meta. Empty when the harness
    // publishes none (older agent / standalone) — fall back to the schema's full catalog picker.
    const modelGroups = useMemo(
        () => buildModelOptionGroups(capabilities, harnessValue),
        [capabilities, harnessValue],
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
            // When the model changes, derive the provider from the picked model; otherwise keep it.
            let nextProvider: string | null
            if (patch.provider !== undefined) {
                nextProvider = patch.provider
            } else if (patch.modelId !== undefined) {
                nextProvider =
                    providerForModel(capabilities, harnessValue, nextModelId) ?? connection.provider
            } else {
                nextProvider = connection.provider
            }
            setAgentField(
                "llm",
                composeModelValue({
                    modelId: nextModelId,
                    provider: nextProvider,
                    mode: patch.mode !== undefined ? patch.mode : connection.mode,
                    slug: patch.slug !== undefined ? patch.slug : connection.slug,
                    existing: llm,
                }),
            )
        },
        [setAgentField, modelId, connection, llm, capabilities, harnessValue],
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

    // Raw-JSON escape hatch for the whole `agent.llm` value (collapsed by default).
    const [showModelJson, setShowModelJson] = useState(false)
    const [modelJsonText, setModelJsonText] = useState(() => JSON.stringify(llm ?? "", null, 2))
    const handleModelJsonChange = useCallback(
        (text: string) => {
            setModelJsonText(text)
            try {
                setAgentField("llm", text ? JSON.parse(text) : "")
            } catch {
                // Keep the invalid text in the editor; don't propagate until it parses.
            }
        },
        [setAgentField],
    )
    const handleToggleModelJson = useCallback(
        (next: boolean) => {
            if (next) setModelJsonText(JSON.stringify(llm ?? "", null, 2))
            setShowModelJson(next)
        },
        [llm],
    )
    // Keep the open JSON buffer in sync when `agent.llm` changes from OUTSIDE the editor
    // (the model picker or the authentication cards). Guard with a structural compare so we
    // only resync on external changes — when the buffer already represents `agent.llm`
    // (the user is typing here) we skip, so we never reformat mid-edit or fight the cursor.
    useEffect(() => {
        if (!showModelJson) return
        let bufferValue: unknown
        try {
            bufferValue = modelJsonText ? JSON.parse(modelJsonText) : ""
        } catch {
            return // invalid in-progress JSON — leave the user's text untouched
        }
        if (JSON.stringify(bufferValue) !== JSON.stringify(llm ?? "")) {
            setModelJsonText(JSON.stringify(llm ?? "", null, 2))
        }
    }, [llm, showModelJson, modelJsonText])

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
    const hasAdvanced = Boolean(
        props.llm || // Authentication lives in Advanced now
        sandboxProps.kind ||
        sandboxProps.permissions ||
        runnerProps.interactions ||
        hasClaudePermissions,
    )

    // The Model picker (inspect-filtered when available, else the schema catalog).
    const modelPicker = props.llm ? (
        hasInspectModels ? (
            <LabeledField
                label="Model"
                description="Filtered to the models this harness can reach. Selecting a model also sets its provider."
                withTooltip={withTooltip}
            >
                <SelectLLMProviderBase
                    showGroup
                    options={modelGroups}
                    value={modelId ?? undefined}
                    onChange={(v) => writeModel({modelId: (v as string) ?? null})}
                    disabled={disabled}
                    placeholder="Select a model…"
                    className="w-full"
                />
            </LabeledField>
        ) : (
            <GroupedChoiceControl
                schema={
                    (props.llm?.properties as Record<string, SchemaProperty> | undefined)?.model ??
                    props.llm
                }
                label="Model"
                value={modelId}
                onChange={(v) => writeModel({modelId: v})}
                withTooltip={withTooltip}
                disabled={disabled}
            />
        )
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

    // Harness list + compatibility (provider/model reachability + connection mode) derive from the
    // inspect capabilities map. GAP (tracked): harness_capabilities covers model/provider/mode/hosting
    // only — NOT tools/skills/MCP — so switching harness can silently leave unsupported tools
    // unwarned. Extend the panel when the backend adds that. See design.md ("Known gap").
    const harnessList = capabilities ? Object.keys(capabilities) : []
    const modelReachable =
        !modelId ||
        !capabilities ||
        !harnessValue ||
        harnessAllowsModel(capabilities, harnessValue, modelId)
    const authSupported = modeOptions.length === 0 || modeOptions.includes(connection.mode)

    const harnessCards = (
        <div className="flex flex-col gap-2">
            {harnessList.map((h) => {
                const caps = capabilities?.[h]
                const selected = harnessValue === h
                const providers = caps?.providers ?? []
                const deployments = caps?.deployments ?? []
                const modelCount = caps
                    ? Object.values(caps.models ?? {}).reduce(
                          (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
                          0,
                      )
                    : 0
                const keepsModel = !modelId || harnessAllowsModel(capabilities, h, modelId)
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
                                ? "border-[var(--ant-color-primary)] bg-[var(--ant-color-fill-secondary)]"
                                : "border-[var(--ant-color-border)] bg-[var(--ant-color-fill-quaternary)] hover:border-[var(--ant-color-text-quaternary)] hover:bg-[var(--ant-color-fill-tertiary)]",
                        )}
                    >
                        <div className="flex items-center gap-2">
                            <span
                                className={cn(
                                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-solid",
                                    selected
                                        ? "border-[var(--ant-color-primary)]"
                                        : "border-[var(--ag-c-97A4B0,#97a4b0)]",
                                )}
                            >
                                {selected && (
                                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--ant-color-primary)]" />
                                )}
                            </span>
                            <span className="text-xs font-medium">
                                {enumLabel(harnessProps.kind, h) || h}
                            </span>
                            {selected ? (
                                <span className="ml-auto rounded-full bg-[var(--ant-color-fill-secondary)] px-2 text-[10px] text-[var(--ant-color-primary-text)]">
                                    Current
                                </span>
                            ) : modelId ? (
                                <span
                                    className={cn(
                                        "ml-auto inline-flex items-center gap-1 text-[10.5px]",
                                        keepsModel
                                            ? "text-[var(--ant-color-success)]"
                                            : "text-[var(--ant-color-warning)]",
                                    )}
                                >
                                    {keepsModel ? <Check size={11} /> : <Warning size={11} />}
                                    {keepsModel ? "supports your model" : "model not available"}
                                </span>
                            ) : null}
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

    const compatibilityPanel =
        capabilities && harnessValue ? (
            <div className="flex flex-col gap-4">
                <div>
                    <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--ag-c-97A4B0,#97a4b0)]">
                        Current setup
                    </div>
                    <div className="flex flex-col gap-2 text-xs">
                        {modelId ? (
                            <div
                                className={cn(
                                    "flex items-start gap-1.5",
                                    modelReachable
                                        ? "text-[var(--ant-color-success)]"
                                        : "text-[var(--ant-color-warning)]",
                                )}
                            >
                                {modelReachable ? (
                                    <Check size={14} className="mt-px shrink-0" />
                                ) : (
                                    <Warning size={14} className="mt-px shrink-0" />
                                )}
                                <span>
                                    <span className="font-mono">{modelId}</span>{" "}
                                    {modelReachable ? "is reachable." : "is not reachable here."}
                                </span>
                            </div>
                        ) : (
                            <span className="text-[var(--ag-c-97A4B0,#97a4b0)]">
                                No model selected.
                            </span>
                        )}
                        {props.llm ? (
                            <div
                                className={cn(
                                    "flex items-start gap-1.5",
                                    authSupported
                                        ? "text-[var(--ant-color-success)]"
                                        : "text-[var(--ant-color-warning)]",
                                )}
                            >
                                {authSupported ? (
                                    <Check size={14} className="mt-px shrink-0" />
                                ) : (
                                    <Warning size={14} className="mt-px shrink-0" />
                                )}
                                <span>
                                    {connection.mode === "agenta"
                                        ? "Agenta-managed"
                                        : "Self-managed"}{" "}
                                    auth{" "}
                                    {authSupported ? "is supported." : "is not supported here."}
                                </span>
                            </div>
                        ) : null}
                    </div>
                </div>

                {modelId && harnessList.some((h) => h !== harnessValue) ? (
                    <div>
                        <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--ag-c-97A4B0,#97a4b0)]">
                            If you switch
                        </div>
                        <div className="flex flex-col gap-2 text-xs">
                            {harnessList
                                .filter((h) => h !== harnessValue)
                                .map((h) => {
                                    const keeps = harnessAllowsModel(capabilities, h, modelId)
                                    return (
                                        <div key={h} className="flex items-start gap-1.5">
                                            {keeps ? (
                                                <Check
                                                    size={14}
                                                    className="mt-px shrink-0 text-[var(--ant-color-success)]"
                                                />
                                            ) : (
                                                <Warning
                                                    size={14}
                                                    className="mt-px shrink-0 text-[var(--ant-color-warning)]"
                                                />
                                            )}
                                            <span className="text-[var(--ag-c-586673,#586673)]">
                                                <span className="text-[var(--ag-c-1C2C3D,#1c2c3d)]">
                                                    {enumLabel(harnessProps.kind, h) || h}
                                                </span>{" "}
                                                {keeps
                                                    ? "supports your model."
                                                    : "doesn't support your model — pick a new one."}
                                            </span>
                                        </div>
                                    )
                                })}
                        </div>
                    </div>
                ) : null}

                {versionHistorySkeleton}
            </div>
        ) : null

    // Model & harness drawer body. With inspect capabilities: harness cards + model picker on the
    // left, a real compatibility panel on the right. Without them: the plain harness select.
    // Shared Model & harness controls — rendered by both the wide drawer body (with the
    // compatibility side panel) and the trimmed tabs-inline body (single column, no chrome).
    const modelHarnessControls = capabilities ? (
        <>
            <div className="flex gap-2 rounded-md bg-[var(--ant-color-fill-quaternary)] p-2.5">
                <Lightbulb size={15} className="mt-px shrink-0 text-[var(--ag-c-586673,#586673)]" />
                <span className="text-[11.5px] leading-snug text-[var(--ag-c-586673,#586673)]">
                    The harness is the runtime that executes your agent. It decides which providers,
                    hosting and connection options you can use.
                </span>
            </div>
            <div>
                <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--ag-c-97A4B0,#97a4b0)]">
                    Harness
                </div>
                {harnessCards}
            </div>
            {modelPicker}
        </>
    ) : (
        <>
            {harnessProps.kind && (
                <HarnessSelectControl
                    schema={harnessProps.kind}
                    label="Harness"
                    value={(harness.kind as string | null) ?? null}
                    onChange={(v) => setSection("harness", {...harness, kind: v})}
                    withTooltip={withTooltip}
                    disabled={disabled}
                />
            )}
            {modelPicker}
        </>
    )

    const modelHarnessDrawerBody = capabilities ? (
        <div className="flex h-full min-h-0 gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                {modelHarnessControls}
            </div>
            <div className="w-[240px] shrink-0 overflow-y-auto">{compatibilityPanel}</div>
        </div>
    ) : (
        <div className="flex h-full flex-col gap-3 overflow-y-auto">{modelHarnessControls}</div>
    )

    // Trimmed body for the tabs layout: the same controls in one column, without the drawer's
    // two-panel split or side panel (which read as out-of-place chrome inside a tab).
    const modelHarnessInline = <div className="flex flex-col gap-4">{modelHarnessControls}</div>

    // Authentication (credential source) — moved out of Model & harness into Advanced.
    const authControls = props.llm ? (
        <div className="flex flex-col gap-2">
            {modeOptions.map((m) => {
                const selected = connection.mode === m
                const title = m === "agenta" ? "Agenta-managed" : "Self-managed"
                const desc =
                    m === "agenta"
                        ? "Agenta supplies the credential from this project's vault — the default provider key, or a named connection you pick below."
                        : "The harness signs in itself (an environment variable or a prior OAuth login). Agenta injects no credential."
                return (
                    <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={disabled}
                        onClick={() => writeModel({mode: m})}
                        className={cn(
                            "flex w-full items-start gap-2.5 rounded-lg border border-solid p-2.5 text-left transition-colors",
                            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                            selected
                                ? "border-[var(--ant-color-primary)] bg-[var(--ant-color-fill-secondary)]"
                                : "border-[var(--ant-color-border)] bg-[var(--ant-color-fill-quaternary)] hover:border-[var(--ant-color-text-quaternary)] hover:bg-[var(--ant-color-fill-tertiary)]",
                        )}
                    >
                        <span
                            className={cn(
                                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-solid",
                                selected
                                    ? "border-[var(--ant-color-primary)]"
                                    : "border-[var(--ant-color-text-tertiary)]",
                            )}
                        >
                            {selected && (
                                <span className="h-2 w-2 rounded-full bg-[var(--ant-color-primary)]" />
                            )}
                        </span>
                        <span className="flex flex-col gap-0.5">
                            <Typography.Text
                                className={cn(
                                    "text-xs font-medium leading-none",
                                    selected && "!text-[var(--ant-color-primary-text)]",
                                )}
                            >
                                {title}
                            </Typography.Text>
                            <Typography.Text type="secondary" className="text-[11px] leading-snug">
                                {desc}
                            </Typography.Text>
                        </span>
                    </button>
                )
            })}
            {connection.mode === "agenta" && (
                <LabeledField
                    label="Connection"
                    description="Which stored connection supplies the credential. Project default uses the project's provider key."
                    withTooltip={withTooltip}
                >
                    <Select<string>
                        value={connection.slug ?? "__default__"}
                        onChange={(v) =>
                            writeModel({slug: v === "__default__" ? null : (v ?? null)})
                        }
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
            )}

            {/* Raw-JSON escape hatch for the whole `agent.llm` value, collapsed by default. */}
            <div className="flex items-center gap-2">
                <Switch
                    checked={showModelJson}
                    onChange={handleToggleModelJson}
                    disabled={disabled}
                />
                <Typography.Text className="text-xs">Edit as JSON</Typography.Text>
            </div>
            {showModelJson && (
                <CodeEditor
                    value={modelJsonText}
                    onChange={handleModelJsonChange}
                    language="json"
                    disabled={disabled}
                />
            )}
        </div>
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
    const advancedControls = (
        <>
            {authControls ? (
                <div>
                    <div className="mb-0.5 flex items-center gap-1.5">
                        <Key size={15} className="text-[var(--ag-c-586673,#586673)]" />
                        <span className="text-[13px] font-medium">Authentication</span>
                    </div>
                    <p className="mb-2.5 ml-[22px] text-[11.5px] leading-snug text-[var(--ag-c-97A4B0,#97a4b0)]">
                        Where the model credential comes from when this agent runs.
                    </p>
                    <div className="ml-[22px]">{authControls}</div>
                </div>
            ) : null}

            {hasExecutionGroup ? (
                <div className="border-0 border-t border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] pt-4">
                    <div className="mb-0.5 flex items-center gap-1.5">
                        <Cube size={15} className="text-[var(--ag-c-586673,#586673)]" />
                        <span className="text-[13px] font-medium">Execution environment</span>
                    </div>
                    <p className="mb-2.5 ml-[22px] text-[11.5px] leading-snug text-[var(--ag-c-97A4B0,#97a4b0)]">
                        Where the agent&apos;s tools and code run, and what that sandbox may touch.
                    </p>
                    <div className="ml-[22px] flex flex-col gap-2.5">
                        {sandboxProps.kind && (
                            <EnumSelectControl
                                schema={sandboxProps.kind}
                                label="Sandbox"
                                value={(sandbox.kind as string | null) ?? null}
                                onChange={(v) => setSection("sandbox", {...sandbox, kind: v})}
                                withTooltip={withTooltip}
                                disabled={disabled}
                            />
                        )}
                        {sandboxProps.permissions ? (
                            <SandboxPermissionControl
                                value={
                                    (sandbox.permissions as Record<string, unknown> | null) ?? null
                                }
                                onChange={(v) =>
                                    setSection("sandbox", {...sandbox, permissions: v})
                                }
                                disabled={disabled}
                            />
                        ) : null}
                    </div>
                </div>
            ) : null}

            {hasPermissionsGroup ? (
                <div className="border-0 border-t border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] pt-4">
                    <div className="mb-0.5 flex items-center gap-1.5">
                        <ShieldCheck size={15} className="text-[var(--ag-c-586673,#586673)]" />
                        <span className="text-[13px] font-medium">Permissions</span>
                    </div>
                    <p className="mb-2.5 ml-[22px] text-[11.5px] leading-snug text-[var(--ag-c-97A4B0,#97a4b0)]">
                        What the agent may do on its own before it must ask.
                    </p>
                    <div className="ml-[22px] flex flex-col gap-2.5">
                        {headlessSchema ? (
                            isPiHarness ? (
                                <div className="flex items-center gap-1.5 text-[11px] text-[var(--ag-c-97A4B0,#97a4b0)]">
                                    <EyeSlash size={13} />
                                    Permission policy isn&apos;t used by the Pi harness.
                                </div>
                            ) : (
                                <EnumSelectControl
                                    schema={headlessSchema}
                                    label="Permission policy"
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
                            )
                        ) : null}
                        {hasClaudePermissions ? (
                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-center gap-1.5">
                                    <Typography.Text className="text-xs font-medium">
                                        Claude permissions
                                    </Typography.Text>
                                    <span className="rounded-full bg-[var(--ant-color-fill-secondary)] px-2 text-[10px] text-[var(--ant-color-primary-text)]">
                                        Claude harness
                                    </span>
                                </div>
                                <ClaudePermissionsControl
                                    value={claudePermissions}
                                    onChange={setClaudePermissions}
                                    disabled={disabled}
                                />
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </>
    )

    const advancedDrawerBody = (
        <div className="flex h-full min-h-0 gap-6">
            <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                {advancedControls}
            </div>
            <div className="w-[240px] shrink-0 overflow-y-auto">{versionHistorySkeleton}</div>
        </div>
    )

    // Trimmed body for the tabs layout: the grouped controls in one column, no side panel.
    const advancedInline = <div className="flex flex-col gap-4">{advancedControls}</div>

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
