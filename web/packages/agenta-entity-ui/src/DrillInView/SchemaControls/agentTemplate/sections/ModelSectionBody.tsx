/**
 * The Model section's body: the connection-first model picker, with the catalog picker as its
 * fallback. `useModelHarness` owns the model state and passes it in.
 */
import type {ReactNode} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import type {HarnessCapabilitiesMap} from "@agenta/entities/workflow"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"

import type {PickerSelection} from "../../connectionPicker"
import type {buildModelOptionGroups, connectionFromConfig} from "../../connectionUtils"
import {GroupedChoiceControl} from "../../GroupedChoiceControl"
import {CatalogUnavailableNotice} from "../CatalogUnavailableNotice"
import ModelPickerControl from "../ModelPickerControl"

import type {ModelHarnessT} from "./types"

export interface ModelSectionBodyParams {
    t: ModelHarnessT
    props: Record<string, SchemaProperty>
    hasInspectModels: boolean
    modelGroups: ReturnType<typeof buildModelOptionGroups>
    modelId: string | null
    writeModel: (patch: {
        modelId?: string | null
        slug?: string | null
        metadataProvider?: string | null
    }) => void
    disabled?: boolean
    llmProviderConfig?: {footerContent?: ReactNode} | null
    capabilities: HarnessCapabilitiesMap | null | undefined
    harnessList: string[]
    harnessValue: string | null
    connection: ReturnType<typeof connectionFromConfig>
    revisionId?: string | null
    onlyCurrentConnection: boolean
    applyPickerSelection: (selection: PickerSelection) => void
    retryCatalog: () => void
    catalogUnavailable: boolean
    modelInFocus: boolean
    harnessKindInFocus: boolean
}

export const modelSectionBody = ({
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
}: ModelSectionBodyParams): ReactNode => {
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
                placeholder={t("entityUi.modelHarness.selectModel")}
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
            provider={connection.provider ?? null}
            mode={connection.mode}
            slug={connection.slug ?? null}
            namespace={connection.namespace}
            replaceable={revisionId?.startsWith("local-") ?? false}
            disabled={disabled}
            // A subscription is a login mounted into the deployment; cloud has nowhere to mount one.
            // isCloud is really isEE today, which would hide subscriptions on self-hosted EE,
            // exactly where mounted logins exist. Ungated until a real cloud signal exists.
            showSubscriptions={true}
            onlyCurrentConnection={onlyCurrentConnection}
            onSelect={applyPickerSelection}
            fallback={catalogModelControl}
        />
    ) : null

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
    return (
        <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
            {modelHarnessControls}
        </div>
    )
}
