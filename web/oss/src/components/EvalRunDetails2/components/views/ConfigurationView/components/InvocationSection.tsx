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

import {
    applicationReferenceQueryAtomFamily,
    variantReferenceQueryAtomFamily,
} from "../../../../atoms/references"
import {effectiveProjectIdAtom} from "../../../../atoms/run"
import {runInvocationRefsAtomFamily} from "../../../../atoms/runDerived"
import {evaluationVariantConfigAtomFamily} from "../../../../atoms/variantConfig"
import {ApplicationReferenceLabel, VariantReferenceLabel} from "../../../references"
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

    const applicationRef = rawRefs.application ?? rawRefs.application_ref ?? {}
    const applicationRevisionRef = rawRefs.applicationRevision ?? rawRefs.application_revision ?? {}
    const applicationVariantRef = rawRefs.applicationVariant ?? rawRefs.application_variant ?? {}

    const variantId = toIdString(
        applicationRevisionRef?.id ??
            applicationRevisionRef?.revision_id ??
            applicationVariantRef?.id ??
            variantConfig?.variant_ref?.id ??
            variantConfig?.variant_ref?.variant_id ??
            variantConfig?.variant_ref?.variantId,
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

    const applicationAtom = useMemo(
        () => applicationReferenceQueryAtomFamily(applicationId ?? null),
        [applicationId],
    )
    const applicationQuery = useAtomValue(applicationAtom)

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
    const applicationLabel =
        applicationQuery.data?.name ??
        applicationQuery.data?.slug ??
        applicationRef?.name ??
        applicationRef?.app_name ??
        applicationRef?.slug ??
        applicationRef?.app_slug ??
        (applicationId && applicationId.length > 12
            ? `${applicationId.slice(0, 6)}…${applicationId.slice(-4)}`
            : applicationId) ??
        null
    const variantLabel =
        variantName ??
        variantConfig?.variant_ref?.name ??
        variantConfig?.variant_ref?.variant_name ??
        variantConfig?.variant_ref?.slug ??
        variantConfig?.variant_ref?.variant_slug ??
        variantSlug ??
        (variantDisplayId && variantDisplayId.length > 12
            ? `${variantDisplayId.slice(0, 6)}…${variantDisplayId.slice(-4)}`
            : variantDisplayId) ??
        null

    const promptVariantKey = useMemo(() => {
        const variantRef = variantConfig?.variant_ref ?? {}
        const refId = toIdString(
            variantRef?.id ?? variantRef?.variant_id ?? variantRef?.variantId ?? null,
        )
        if (refId) return refId
        return variantId
    }, [variantConfig?.variant_ref, variantId])

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

        const resolvedVariantSlug =
            variantRef?.slug ??
            variantRef?.variant_slug ??
            variantRef?.variantSlug ??
            applicationVariantRef?.slug ??
            applicationVariantRef?.variant_slug ??
            applicationVariantRef?.variantSlug ??
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

        if (!resolvedVariantId && !resolvedVariantSlug) {
            clearProjectVariantReferences()
            return
        }

        const entry: ProjectVariantConfigKey = {
            projectId,
            appId: toIdString(appRef?.id) ?? undefined,
            appSlug: appRef?.slug ?? undefined,
            variantId: resolvedVariantId,
            variantSlug: resolvedVariantSlug,
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
    const [view, setView] = useState<"details" | "json">("details")

    if (!rawRefs || Object.keys(rawRefs).length === 0) return null
    if (isVariantLoading || variantLoading) {
        return <SectionSkeleton lines={4} />
    }

    const headerContent = (
        <div className="flex flex-col gap-1">
            <Text className="text-sm font-semibold text-[#344054]">Application</Text>
            <div className="flex flex-wrap items-center gap-2 mt-1">
                <ApplicationReferenceLabel runId={runId} applicationId={applicationId} />
                {variantId ? (
                    <VariantReferenceLabel
                        variantId={variantId}
                        applicationId={applicationId}
                        runId={runId}
                        fallbackLabel={variantLabel}
                        showVersionPill
                        explicitVersion={variantVersion}
                    />
                ) : variantLabel ? (
                    <span className="text-sm text-[#475467]">{variantLabel}</span>
                ) : null}
            </div>
        </div>
    )

    return (
        <SectionCard>
            <div className="flex items-start justify-between gap-3">
                {headerContent}
                <div className="flex items-center gap-2">
                    {variantConfig ? (
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
        if (isLoading) {
            return <ReadOnlySkeleton />
        }

        if (!hasVariantConfig) {
            return <Text type="secondary">Variant configuration unavailable.</Text>
        }

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
