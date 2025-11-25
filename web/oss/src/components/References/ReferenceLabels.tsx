import {memo, useMemo} from "react"

import {Skeleton, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {
    applicationReferenceQueryAtomFamily,
    testsetReferenceQueryAtomFamily,
    variantReferenceQueryAtomFamily,
    useRunIdentifiers,
    useRunScopedUrls,
} from "./EvalRunReferences"
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
        className,
    }: {
        ids: string[]
        projectURL?: string | null
        runId?: string | null
        className?: string
    }) => {
        if (!ids.length) {
            return <Text type="secondary">—</Text>
        }

        return (
            <div className={clsx("flex flex-wrap gap-2", className)}>
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
        fallbackLabel,
        showVersionPill = false,
        explicitVersion,
    }: {
        variantId?: string | null
        applicationId?: string | null
        runId?: string | null
        fallbackLabel?: string | null
        showVersionPill?: boolean
        explicitVersion?: number | string | null
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
        const label = ref?.name ?? ref?.slug ?? fallbackLabel ?? ref?.id ?? effectiveVariantId
        const resolvedVersion =
            explicitVersion ??
            ref?.revision ??
            ref?.version ??
            (typeof ref?.variant === "object" ? (ref.variant as any)?.revision : null)
        const href = buildVariantPlaygroundHref(effectiveVariantId)

        return (
            <div className="flex items-center gap-2">
                <ReferenceTag
                    label={label}
                    href={href ?? undefined}
                    tooltip={label}
                    copyValue={effectiveVariantId ?? undefined}
                    className="max-w-[220px]"
                    tone="variant"
                />
                {showVersionPill && resolvedVersion ? (
                    <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5 text-xs font-semibold text-[#344054]">
                        v{resolvedVersion}
                    </span>
                ) : null}
            </div>
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
