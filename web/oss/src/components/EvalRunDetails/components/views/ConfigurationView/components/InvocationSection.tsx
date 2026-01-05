import {memo, useEffect, useMemo, useState} from "react"

import {DownOutlined} from "@ant-design/icons"
import {Button, Segmented, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {
    clearProjectVariantReferencesAtom,
    prefetchProjectVariantConfigs,
    setProjectVariantReferencesAtom,
    type ProjectVariantConfigKey,
} from "@/oss/state/projectVariantConfig"

import {variantReferenceQueryAtomFamily} from "../../../../atoms/references"
import {effectiveProjectIdAtom} from "../../../../atoms/run"
import {runInvocationRefsAtomFamily} from "../../../../atoms/runDerived"
import {evaluationVariantConfigAtomFamily} from "../../../../atoms/variantConfig"
import {ApplicationReferenceLabel, VariantRevisionLabel} from "../../../references"
import {toIdString} from "../utils"

import {ReadOnlySkeleton} from "./CopyableFields"
import PromptConfigCard from "./PromptConfigCard"
import {SectionCard, SectionSkeleton} from "./SectionPrimitives"

const {Text} = Typography
const JsonEditor = dynamic(() => import("@/oss/components/Editor/Editor"), {ssr: false})

interface InvocationSectionProps {
    runId: string
}

const InvocationSection = ({runId}: InvocationSectionProps) => {
    const invocationRefs = useAtomValue(useMemo(() => runInvocationRefsAtomFamily(runId), [runId]))
    const rawRefs = useMemo(
        () => invocationRefs?.rawRefs ?? ({} as Record<string, any>),
        [invocationRefs],
    )

    const variantConfigAtom = useMemo(() => evaluationVariantConfigAtomFamily(runId), [runId])
    const variantConfigQuery = useAtomValue(variantConfigAtom)
    const variantConfig = variantConfigQuery.data
    const isVariantLoading = variantConfigQuery.isPending || variantConfigQuery.isFetching

    // DEBUG: Log invocation section state
    console.log("[InvocationSection] runId:", runId)
    console.log("[InvocationSection] invocationRefs:", invocationRefs)
    console.log("[InvocationSection] rawRefs:", rawRefs)
    console.log("[InvocationSection] variantConfigQuery:", {
        isPending: variantConfigQuery.isPending,
        isFetching: variantConfigQuery.isFetching,
        error: variantConfigQuery.error,
        data: variantConfigQuery.data,
    })
    console.log("[InvocationSection] variantConfig:", variantConfig)
    console.log("[InvocationSection] isVariantLoading:", isVariantLoading)

    const applicationRef = rawRefs.application ?? rawRefs.application_ref ?? {}
    const applicationRevisionRef = rawRefs.applicationRevision ?? rawRefs.application_revision ?? {}
    const applicationVariantRef = rawRefs.applicationVariant ?? rawRefs.application_variant ?? {}
    const variantRef = rawRefs.variant ?? rawRefs.variant_ref ?? {}

    // Use variant ID (not revision ID) for the reference label query
    // Priority: variant.id > applicationVariant.id > variantConfig.variant_ref.id
    const variantId = toIdString(
        variantRef?.id ??
            applicationVariantRef?.id ??
            variantConfig?.variant_ref?.id ??
            variantConfig?.variant_ref?.variant_id ??
            variantConfig?.variant_ref?.variantId,
    )

    // Revision ID is used for the prompt config card (to get the specific revision's params)
    const revisionId = toIdString(
        applicationRevisionRef?.id ??
            applicationRevisionRef?.revision_id ??
            variantRef?.id ??
            applicationVariantRef?.id,
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

    const variantAtom = useMemo(() => variantReferenceQueryAtomFamily(variantId), [variantId])
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
    // Truncated IDs should not be treated as valid fallback names
    const variantLabel =
        variantName ??
        variantConfig?.variant_ref?.name ??
        variantConfig?.variant_ref?.variant_name ??
        null

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

    const projectId = useAtomValue(effectiveProjectIdAtom)
    const setProjectVariantReferences = useSetAtom(setProjectVariantReferencesAtom)
    const clearProjectVariantReferences = useSetAtom(clearProjectVariantReferencesAtom)

    useEffect(() => {
        if (!projectId) return

        const variantRef =
            (variantConfig as any)?.variant_ref ??
            (variantConfig as any)?.variantRef ??
            applicationVariantRef ??
            {}
        const appRef =
            (variantConfig as any)?.application_ref ??
            (variantConfig as any)?.applicationRef ??
            applicationRef ??
            {}

        const resolvedVariantId =
            toIdString(variantRef?.id) ??
            toIdString(variantRef?.variant_id) ??
            toIdString(applicationRevisionRef?.id) ??
            toIdString(applicationVariantRef?.id) ??
            undefined

        const rawVersion =
            variantRef?.version ??
            variantRef?.revision ??
            applicationRevisionRef?.version ??
            applicationRevisionRef?.revision ??
            null
        const variantVersion =
            typeof rawVersion === "number"
                ? rawVersion
                : typeof rawVersion === "string" && rawVersion.trim() !== ""
                  ? Number(rawVersion)
                  : null

        if (!resolvedVariantId) {
            clearProjectVariantReferences()
            return
        }

        const entry: ProjectVariantConfigKey = {
            projectId,
            appId: toIdString(appRef?.id) ?? undefined,
            appSlug: appRef?.slug ?? undefined,
            variantId: resolvedVariantId,
            variantVersion: Number.isFinite(variantVersion as number) ? variantVersion : null,
        }

        setProjectVariantReferences([entry])
        prefetchProjectVariantConfigs([entry])

        return () => {
            clearProjectVariantReferences()
        }
    }, [
        projectId,
        setProjectVariantReferences,
        clearProjectVariantReferences,
        variantConfig,
        applicationVariantRef,
        applicationRef,
        applicationRevisionRef,
    ])

    const [collapsed, setCollapsed] = useState(false)

    // When the app/variant is deleted, the URL (openapi schema endpoint) won't be available.
    // In this case, we cannot render the component view and should default to JSON view.
    // We only know the schema is unavailable after loading completes.
    const hasSchemaAvailable = Boolean(variantConfig?.url)
    const schemaDefinitelyUnavailable =
        !isVariantLoading && !variantLoading && variantConfig && !variantConfig.url
    const [view, setView] = useState<"details" | "json">("details")

    // DEBUG: Log view state decision factors
    console.log("[InvocationSection] hasSchemaAvailable:", hasSchemaAvailable)
    console.log("[InvocationSection] schemaDefinitelyUnavailable:", schemaDefinitelyUnavailable)
    console.log("[InvocationSection] variantConfig?.url:", variantConfig?.url)
    console.log("[InvocationSection] current view:", view)
    console.log("[InvocationSection] promptVariantKey:", promptVariantKey)

    // Sync view state when we definitively know schema is unavailable (after loading completes)
    useEffect(() => {
        if (schemaDefinitelyUnavailable && view === "details") {
            setView("json")
        }
    }, [schemaDefinitelyUnavailable, view])

    if (!rawRefs || Object.keys(rawRefs).length === 0) return null
    if (isVariantLoading || variantLoading) {
        return <SectionSkeleton lines={4} />
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
                <span className="text-sm text-[#475467]">{variantLabel}</span>
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
                    <div className="rounded-md border border-solid border-[#E4E7EC] bg-[#F8FAFC]">
                        <JsonEditor
                            initialValue={JSON.stringify(variantConfig, null, 2)}
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
                        title={null}
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
        title,
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
        // DEBUG: Log VariantConfigurationBlock props
        console.log("[VariantConfigurationBlock] isLoading:", isLoading)
        console.log("[VariantConfigurationBlock] hasVariantConfig:", hasVariantConfig)
        console.log("[VariantConfigurationBlock] promptVariantKey:", promptVariantKey)
        console.log("[VariantConfigurationBlock] variantParameters:", variantParameters)
        console.log("[VariantConfigurationBlock] variantDisplayId:", variantDisplayId)
        console.log("[VariantConfigurationBlock] variantName:", variantName)
        console.log("[VariantConfigurationBlock] variantSlug:", variantSlug)
        console.log("[VariantConfigurationBlock] variantResolved:", variantResolved)
        console.log("[VariantConfigurationBlock] variantVersion:", variantVersion)
        console.log("[VariantConfigurationBlock] hasParamsSnapshot:", hasParamsSnapshot)
        console.log("[VariantConfigurationBlock] title:", title)

        if (isLoading) {
            console.log("[VariantConfigurationBlock] Rendering: ReadOnlySkeleton (isLoading)")
            return <ReadOnlySkeleton />
        }

        if (!hasVariantConfig) {
            console.log(
                "[VariantConfigurationBlock] Rendering: 'Variant configuration unavailable' (no hasVariantConfig)",
            )
            return <Text type="secondary">Variant configuration unavailable.</Text>
        }

        console.log("[VariantConfigurationBlock] Rendering: PromptConfigCard with:", {
            variantId: promptVariantKey ?? undefined,
            parameters: variantParameters,
            hasSnapshot: hasParamsSnapshot,
        })

        return (
            <div className="flex flex-col gap-2">
                {title ? <div>{title}</div> : null}
                <PromptConfigCard
                    className="flex flex-col gap-3"
                    variantId={promptVariantKey ?? undefined}
                    parameters={variantParameters}
                    hasSnapshot={hasParamsSnapshot}
                />
            </div>
        )
    },
)

export default memo(InvocationSection)
