import {memo, useEffect, useMemo} from "react"

import {Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

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
import {ApplicationReferenceLabel, VariantReferenceLabel} from "../../../reference"
import {toIdString} from "../utils"

import {ReadOnlySkeleton} from "./CopyableFields"
import PromptConfigCard from "./PromptConfigCard"
import {SectionCard} from "./SectionPrimitives"

const {Text} = Typography

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

    if (!rawRefs || Object.keys(rawRefs).length === 0) return null

    return (
        <SectionCard>
            <VariantConfigurationBlock
                title={
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <ApplicationReferenceLabel
                                runId={runId}
                                applicationId={toIdString(applicationRef?.id) ?? null}
                            />
                            <VariantReferenceLabel
                                runId={runId}
                                variantId={variantId}
                                applicationId={toIdString(applicationRef?.id) ?? null}
                            />
                            {variantVersion ? (
                                <Tag className="!m-0 !bg-[#0517290F]" bordered={false}>
                                    V{variantVersion}
                                </Tag>
                            ) : null}
                        </div>
                    </div>
                }
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
                <Text
                    type="secondary"
                    style={{textTransform: "uppercase", fontWeight: 600, fontSize: 12}}
                >
                    {title}
                </Text>
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
