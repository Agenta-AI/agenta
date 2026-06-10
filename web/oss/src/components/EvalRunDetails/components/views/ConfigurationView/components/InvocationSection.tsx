import {memo, useEffect, useMemo, useState} from "react"

import {variantReferenceQueryAtomFamily} from "@agenta/evaluations/state/evalRun"
import {runInvocationRefsAtomFamily} from "@agenta/evaluations/state/evalRun"
import {evaluationVariantConfigAtomFamily} from "@agenta/evaluations/state/evalRun"
import {DownOutlined} from "@ant-design/icons"
import {Button, Segmented, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {ApplicationReferenceLabel, VariantRevisionLabel} from "../../../references"
import {toIdString} from "../utils"

import {ReadOnlySkeleton} from "./CopyableFields"
import PromptConfigCard from "./PromptConfigCard"
import {DefList, DefRow, SectionCard, SectionSkeleton} from "./SectionPrimitives"

const {Text} = Typography
const JsonEditor = dynamic(() => import("@agenta/ui/editor").then((module) => module.Editor), {
    ssr: false,
})
interface InvocationSectionProps {
    runId: string
    /** V2 layout: render definition-list rows only (the shell owns the card). */
    embedded?: boolean
    /** Controlled Details/JSON view (V2 shell owns the segmented control). */
    view?: "details" | "json"
    /** Compare mode: per-row differs flags vs the base run. */
    diff?: {app?: boolean; variant?: boolean} | null
}

const InvocationSection = ({
    runId,
    embedded = false,
    view: controlledView,
    diff,
}: InvocationSectionProps) => {
    const invocationRefs = useAtomValue(useMemo(() => runInvocationRefsAtomFamily(runId), [runId]))
    const rawRefs = useMemo(
        () => invocationRefs?.rawRefs ?? ({} as Record<string, any>),
        [invocationRefs],
    )

    const variantConfigAtom = useMemo(() => evaluationVariantConfigAtomFamily(runId), [runId])
    const variantConfigQuery = useAtomValue(variantConfigAtom)
    const variantConfig = variantConfigQuery.data
    const isVariantLoading = variantConfigQuery.isPending || variantConfigQuery.isFetching

    const applicationRef = rawRefs.application ?? rawRefs.application_ref ?? {}
    const applicationRevisionRef = rawRefs.applicationRevision ?? rawRefs.application_revision ?? {}
    const applicationVariantRef = rawRefs.applicationVariant ?? rawRefs.application_variant ?? {}
    const variantRef = rawRefs.variant ?? rawRefs.variant_ref ?? {}

    // Variant (artifact) ID from rawRefs — NOT a revision ID
    const variantId = toIdString(variantRef?.id ?? applicationVariantRef?.id ?? null)

    // Revision ID: prefer the ID returned by the workflow API (variantConfig.variant_ref.id)
    // because rawRefs often only contain variant (artifact) IDs, not revision IDs.
    // The evaluationVariantConfigAtomFamily fetches the actual workflow revision and stores
    // the true revision ID in variant_ref.id.
    const revisionId = toIdString(
        variantConfig?.variant_ref?.id ??
            applicationRevisionRef?.id ??
            applicationRevisionRef?.revision_id ??
            null,
    )

    const applicationId = toIdString(
        applicationRef?.id ??
            applicationRef?.app_id ??
            applicationRevisionRef?.application_id ??
            applicationRevisionRef?.applicationId ??
            applicationVariantRef?.application_id ??
            applicationVariantRef?.applicationId ??
            null,
    )

    // Query with revisionId (not variantId) because workflowMolecule is keyed by revision ID
    const variantAtom = useMemo(
        () => variantReferenceQueryAtomFamily(revisionId ?? variantId),
        [revisionId, variantId],
    )
    const variantQuery = useAtomValue(variantAtom)
    const variantLoading = variantQuery.isPending || variantQuery.isFetching
    const variantResolved = variantQuery.data
    const variantName =
        variantResolved?.name ??
        applicationVariantRef?.name ??
        applicationVariantRef?.variant_name ??
        variantResolved?.slug ??
        applicationVariantRef?.slug ??
        applicationRevisionRef?.slug ??
        null
    const variantSlug =
        variantResolved?.slug ?? applicationVariantRef?.slug ?? applicationRevisionRef?.slug ?? null
    const variantDisplayId = variantResolved?.id ?? variantId ?? undefined
    const variantVersion =
        variantResolved?.revision ??
        variantResolved?.version ??
        applicationRevisionRef?.version ??
        applicationRevisionRef?.revision ??
        applicationVariantRef?.version ??
        variantConfig?.variant_ref?.version ??
        null

    const hasParamsSnapshot = Boolean(variantConfig?.params)

    // Only use actual resolved names as fallback, not truncated IDs
    const variantLabel =
        variantName ?? variantConfig?.variant_ref?.name ?? variantConfig?.variant_ref?.slug ?? null

    // Use revisionId for the prompt config card (specific revision's params)
    const promptVariantKey = useMemo(() => {
        const configVariantRef = variantConfig?.variant_ref ?? {}
        const refId = toIdString(
            configVariantRef?.id ??
                configVariantRef?.variant_id ??
                configVariantRef?.variantId ??
                null,
        )
        if (refId) return refId
        return revisionId ?? variantId
    }, [variantConfig?.variant_ref, revisionId, variantId])

    const [collapsed, setCollapsed] = useState(false)

    const variantConfigJson = useMemo(
        () => (variantConfig ? JSON.stringify(variantConfig, null, 2) : ""),
        [variantConfig],
    )

    // When the app/variant is deleted, the URL (openapi schema endpoint) won't be available.
    // In this case, we cannot render the component view and should default to JSON view.
    // We only know the schema is unavailable after loading completes.
    const hasSchemaAvailable = Boolean(variantConfig?.url)
    const schemaDefinitelyUnavailable =
        !isVariantLoading && !variantLoading && variantConfig && !variantConfig.url
    const [internalView, setView] = useState<"details" | "json">("details")
    const view = controlledView ?? internalView

    // Sync view state when we definitively know schema is unavailable (after loading completes)
    useEffect(() => {
        if (schemaDefinitelyUnavailable && !controlledView && internalView === "details") {
            setView("json")
        }
    }, [schemaDefinitelyUnavailable, controlledView, internalView])

    if (!rawRefs || Object.keys(rawRefs).length === 0) return null
    if (isVariantLoading || variantLoading) {
        return <SectionSkeleton lines={4} />
    }

    if (embedded) {
        const jsonBlock = variantConfig ? (
            <div className="rounded-md border border-solid border-[var(--ag-c-E4E7EC)] bg-[var(--ag-c-F8FAFC)]">
                <JsonEditor
                    initialValue={variantConfigJson}
                    language="json"
                    codeOnly
                    showToolbar={false}
                    disabled
                    enableResize={false}
                    boundWidth
                    dimensions={{width: "100%", height: 320}}
                />
            </div>
        ) : (
            <Text type="secondary">Variant configuration unavailable.</Text>
        )

        return (
            <div className="flex flex-col gap-3">
                <DefList>
                    <DefRow label="Application" differs={diff?.app}>
                        <ApplicationReferenceLabel runId={runId} applicationId={applicationId} />
                    </DefRow>
                    <DefRow label="Variant" differs={diff?.variant}>
                        {variantId || revisionId ? (
                            <VariantRevisionLabel
                                variantId={variantId}
                                revisionId={revisionId}
                                applicationId={applicationId}
                                runId={runId}
                                fallbackVariantName={variantLabel}
                                fallbackRevision={variantVersion}
                            />
                        ) : variantLabel ? (
                            <span className="text-sm text-[var(--ag-c-475467)]">
                                {variantLabel}
                            </span>
                        ) : (
                            <Text type="secondary">—</Text>
                        )}
                    </DefRow>
                    <DefRow label="Type">
                        <Tag className="!m-0">
                            {hasSchemaAvailable ? "Workflow" : "Custom workflow"}
                        </Tag>
                        {!hasSchemaAvailable ? (
                            <Text type="secondary" className="text-[12.5px]">
                                No playground schema — snapshot available as JSON
                            </Text>
                        ) : null}
                    </DefRow>
                </DefList>
                {view === "json" || !hasSchemaAvailable ? (
                    jsonBlock
                ) : (
                    <VariantConfigurationBlock
                        isLoading={isVariantLoading || variantLoading}
                        hasVariantConfig={Boolean(variantConfig)}
                        promptVariantKey={promptVariantKey}
                        variantParameters={variantConfig?.params}
                        variantDisplayId={variantDisplayId}
                        variantName={variantName}
                        variantSlug={variantSlug}
                        variantResolved={variantResolved}
                        variantVersion={variantVersion}
                        hasParamsSnapshot={hasParamsSnapshot}
                    />
                )}
            </div>
        )
    }

    const headerContent = (
        <div className="flex flex-wrap items-center gap-2">
            <ApplicationReferenceLabel runId={runId} applicationId={applicationId} />
            {variantId || revisionId ? (
                <VariantRevisionLabel
                    variantId={variantId}
                    revisionId={revisionId}
                    applicationId={applicationId}
                    runId={runId}
                    fallbackVariantName={variantLabel}
                    fallbackRevision={variantVersion}
                />
            ) : variantLabel ? (
                <span className="text-sm text-[var(--ag-c-475467)]">{variantLabel}</span>
            ) : null}
        </div>
    )

    return (
        <SectionCard>
            <div className="flex items-start justify-between gap-3">
                {headerContent}
                <div className="flex items-center gap-2">
                    {variantConfig && hasSchemaAvailable ? (
                        <Segmented
                            options={[
                                {label: "Details", value: "details"},
                                {label: "JSON", value: "json"},
                            ]}
                            size="small"
                            value={view}
                            onChange={(val) => setView(val as "details" | "json")}
                        />
                    ) : null}
                    <Button
                        type="text"
                        size="small"
                        icon={<DownOutlined rotate={collapsed ? -90 : 0} style={{fontSize: 12}} />}
                        onClick={() => setCollapsed((v) => !v)}
                    />
                </div>
            </div>

            {!collapsed ? (
                view === "json" && variantConfig ? (
                    <div className="rounded-md border border-solid border-[var(--ag-c-E4E7EC)] bg-[var(--ag-c-F8FAFC)]">
                        <JsonEditor
                            initialValue={variantConfigJson}
                            language="json"
                            codeOnly
                            showToolbar={false}
                            disabled
                            enableResize={false}
                            boundWidth
                            dimensions={{width: "100%", height: 320}}
                        />
                    </div>
                ) : (
                    <VariantConfigurationBlock
                        isLoading={isVariantLoading || variantLoading}
                        hasVariantConfig={Boolean(variantConfig)}
                        promptVariantKey={promptVariantKey}
                        variantParameters={variantConfig?.params}
                        variantDisplayId={variantDisplayId}
                        variantName={variantName}
                        variantSlug={variantSlug}
                        variantResolved={variantResolved}
                        variantVersion={variantVersion}
                        hasParamsSnapshot={hasParamsSnapshot}
                    />
                )
            ) : null}
        </SectionCard>
    )
}

const VariantConfigurationBlock = memo(
    ({
        isLoading,
        hasVariantConfig,
        promptVariantKey,
        variantParameters,
        variantDisplayId,
        variantName,
        variantSlug,
        variantResolved,
        variantVersion,
        hasParamsSnapshot,
    }: {
        isLoading: boolean
        hasVariantConfig: boolean
        promptVariantKey: string | null
        variantParameters: Record<string, any> | null | undefined
        variantDisplayId: string | undefined
        variantName: string | null
        variantSlug: string | null
        variantResolved: any
        variantVersion: number | string | null
        hasParamsSnapshot: boolean
    }) => {
        if (isLoading) {
            return <ReadOnlySkeleton />
        }

        if (!hasVariantConfig) {
            return <Text type="secondary">Variant configuration unavailable.</Text>
        }

        return (
            <PromptConfigCard
                className="flex flex-col gap-3"
                variantId={promptVariantKey ?? undefined}
                parameters={variantParameters}
                hasSnapshot={hasParamsSnapshot}
            />
        )
    },
)

export default memo(InvocationSection)
