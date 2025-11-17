import {memo, useMemo} from "react"

import {Skeleton, Typography} from "antd"
import {useAtomValue} from "jotai"

import {
    applicationReferenceQueryAtomFamily,
    testsetReferenceQueryAtomFamily,
    variantReferenceQueryAtomFamily,
} from "../../atoms/references"
import useRunIdentifiers from "../../hooks/useRunIdentifiers"
import useRunScopedUrls from "../../hooks/useRunScopedUrls"

import ReferenceTag from "./ReferenceTag"

const {Text} = Typography

const TestsetTag = memo(
    ({
        testsetId,
        projectURL,
        runId,
    }: {
        testsetId: string
        projectURL?: string | null
        runId?: string | null
    }) => {
        const queryAtom = useMemo(
            () => testsetReferenceQueryAtomFamily(testsetId ?? null),
            [testsetId],
        )
        const query = useAtomValue(queryAtom)
        const {buildTestsetHref} = useRunScopedUrls(runId)

        if (query.isPending || query.isFetching) {
            return <Skeleton.Input active size="small" style={{width: 160}} />
        }

        const ref = query.data
        const label = ref?.name ?? ref?.id ?? testsetId
        const href =
            buildTestsetHref(testsetId) ??
            (projectURL ? `${projectURL}/testsets/${testsetId}` : null)

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={label}
                copyValue={testsetId}
                className="max-w-[220px]"
                tone="testset"
            />
        )
    },
)

export const TestsetTagList = memo(
    ({
        ids,
        projectURL,
        runId,
    }: {
        ids: string[]
        projectURL?: string | null
        runId?: string | null
    }) => {
        if (!ids.length) {
            return <Text type="secondary">—</Text>
        }

        return (
            <div className="flex flex-wrap gap-2">
                {ids.map((id) => (
                    <TestsetTag key={id} testsetId={id} projectURL={projectURL} runId={runId} />
                ))}
            </div>
        )
    },
)

export const ApplicationReferenceLabel = memo(
    ({
        runId,
        applicationId: explicitApplicationId,
        projectURL: explicitProjectURL,
    }: {
        runId?: string | null
        applicationId?: string | null
        projectURL?: string | null
    }) => {
        const {applicationId: runApplicationId} = useRunIdentifiers(runId)
        const {
            applicationId: scopedApplicationId,
            projectURL: scopedProjectURL,
            appDetailHref,
        } = useRunScopedUrls(runId, explicitApplicationId ?? runApplicationId ?? null)

        const applicationId =
            explicitApplicationId ?? scopedApplicationId ?? runApplicationId ?? null
        const projectURL = explicitProjectURL ?? scopedProjectURL

        const queryAtom = useMemo(
            () => applicationReferenceQueryAtomFamily(applicationId ?? null),
            [applicationId],
        )
        const query = useAtomValue(queryAtom)

        if (!applicationId) {
            return <Text type="secondary">—</Text>
        }

        if (query.isPending || query.isFetching) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        const label = ref?.name ?? ref?.slug ?? ref?.id ?? applicationId
        const href =
            appDetailHref ??
            (projectURL && applicationId ? `${projectURL}/apps/${applicationId}` : null)

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={label}
                copyValue={applicationId ?? undefined}
                className="max-w-[220px]"
                tone="app"
            />
        )
    },
)

export const VariantReferenceLabel = memo(
    ({
        variantId: explicitVariantId,
        applicationId: explicitApplicationId,
        runId,
    }: {
        variantId?: string | null
        applicationId?: string | null
        runId?: string | null
    }) => {
        const {variantId: runVariantId, applicationId: runApplicationId} = useRunIdentifiers(runId)
        const effectiveVariantId = explicitVariantId ?? runVariantId ?? null
        const effectiveApplicationId = explicitApplicationId ?? runApplicationId ?? null
        const {buildVariantPlaygroundHref} = useRunScopedUrls(runId, effectiveApplicationId)

        const queryAtom = useMemo(
            () => variantReferenceQueryAtomFamily(effectiveVariantId ?? null),
            [effectiveVariantId],
        )
        const query = useAtomValue(queryAtom)

        if (!effectiveVariantId) {
            return <Text type="secondary">—</Text>
        }

        if (query.isPending || query.isFetching) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        const label = ref?.name ?? ref?.slug ?? ref?.id ?? effectiveVariantId
        const href = buildVariantPlaygroundHref(effectiveVariantId)

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={label}
                copyValue={effectiveVariantId ?? undefined}
                className="max-w-[220px]"
                tone="variant"
            />
        )
    },
)

export const VariantReferenceText = memo(
    ({variantId, fallback}: {variantId: string | null; fallback?: string}) => {
        const queryAtom = useMemo(
            () => variantReferenceQueryAtomFamily(variantId ?? null),
            [variantId],
        )
        const query = useAtomValue(queryAtom)

        if (!variantId) {
            return <Text type="secondary">{fallback ?? "—"}</Text>
        }

        if (query.isPending || query.isFetching) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        const label = ref?.name ?? ref?.slug ?? ref?.id ?? variantId

        return <Text>{label}</Text>
    },
)
