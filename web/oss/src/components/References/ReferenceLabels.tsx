import {memo, useMemo} from "react"

import {Skeleton, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {
    appReferenceAtomFamily,
    evaluatorReferenceAtomFamily,
    previewTestsetReferenceAtomFamily,
    queryReferenceAtomFamily,
    variantConfigAtomFamily,
} from "./atoms/entityReferences"
import ReferenceTag from "./ReferenceTag"

const {Text} = Typography

/**
 * Generic testset tag that fetches and displays a testset reference.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const TestsetTag = memo(
    ({
        testsetId,
        projectId,
        projectURL,
    }: {
        testsetId: string
        projectId: string | null
        projectURL?: string | null
    }) => {
        const queryAtom = useMemo(
            () => previewTestsetReferenceAtomFamily({projectId, testsetId}),
            [projectId, testsetId],
        )
        const query = useAtomValue(queryAtom)

        if ((query.isPending || query.isFetching) && !query.isError) {
            return <Skeleton.Input active size="small" style={{width: 160}} />
        }

        const ref = query.data
        // If we have an ID but no name, or query errored, the testset was likely deleted
        const isDeleted = Boolean(query.isError || (ref?.id && !ref?.name))
        const label = isDeleted ? "Deleted" : (ref?.name ?? ref?.id ?? testsetId)
        // Don't show link for deleted testsets
        const href = isDeleted ? null : projectURL ? `${projectURL}/testsets/${testsetId}` : null

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={isDeleted ? `Testset ${testsetId} was deleted` : label}
                copyValue={testsetId}
                className="max-w-[220px] w-fit"
                tone="testset"
            />
        )
    },
)

/**
 * Generic testset tag list that renders multiple testset tags.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const TestsetTagList = memo(
    ({
        ids,
        projectId,
        projectURL,
        className,
    }: {
        ids: string[]
        projectId: string | null
        projectURL?: string | null
        className?: string
    }) => {
        if (!ids.length) {
            return <Text type="secondary">—</Text>
        }

        return (
            <div className={clsx("flex flex-wrap gap-2", className)}>
                {ids.map((id) => (
                    <TestsetTag
                        key={id}
                        testsetId={id}
                        projectId={projectId}
                        projectURL={projectURL}
                    />
                ))}
            </div>
        )
    },
)

/**
 * Generic application reference label that fetches and displays an app reference.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const ApplicationReferenceLabel = memo(
    ({
        applicationId,
        projectId,
        projectURL,
        href: explicitHref,
    }: {
        applicationId: string | null
        projectId: string | null
        projectURL?: string | null
        href?: string | null
    }) => {
        const queryAtom = useMemo(
            () => appReferenceAtomFamily({projectId, appId: applicationId}),
            [projectId, applicationId],
        )
        const query = useAtomValue(queryAtom)

        if (!applicationId) {
            return <Text type="secondary">—</Text>
        }

        if ((query.isPending || query.isFetching) && !query.isError) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        // If we have an ID but no name/slug, or query errored, the app was likely deleted
        const isDeleted = Boolean(query.isError || (ref?.id && !ref?.name && !ref?.slug))
        const label = isDeleted ? "Deleted" : (ref?.name ?? ref?.slug ?? ref?.id ?? applicationId)
        // Don't show link for deleted apps
        const href = isDeleted
            ? null
            : (explicitHref ??
              (projectURL && applicationId ? `${projectURL}/apps/${applicationId}` : null))

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={isDeleted ? `Application ${applicationId} was deleted` : label}
                copyValue={applicationId ?? undefined}
                className="max-w-[220px] w-fit"
                tone="app"
            />
        )
    },
)

/**
 * Generic variant reference label that fetches and displays a variant config reference.
 * Uses revisionId to fetch variant config details.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const VariantReferenceLabel = memo(
    ({
        revisionId,
        projectId,
        fallbackLabel,
        showVersionPill = false,
        explicitVersion,
        href: explicitHref,
    }: {
        revisionId?: string | null
        projectId: string | null
        fallbackLabel?: string | null
        showVersionPill?: boolean
        explicitVersion?: number | string | null
        href?: string | null
    }) => {
        const queryAtom = useMemo(
            () => variantConfigAtomFamily({projectId, revisionId}),
            [projectId, revisionId],
        )
        const query = useAtomValue(queryAtom)

        if (!revisionId) {
            return <Text type="secondary">—</Text>
        }

        if ((query.isPending || query.isFetching) && !query.isError) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        // If we have a revisionId but no variantName and no revision, or query errored, the variant was likely deleted
        const isDeleted = Boolean(
            query.isError || (ref?.revisionId && !ref?.variantName && ref?.revision == null),
        )
        const label = isDeleted
            ? "Deleted"
            : (ref?.variantName ?? fallbackLabel ?? ref?.revisionId ?? revisionId)
        const resolvedVersion = isDeleted ? null : (explicitVersion ?? ref?.revision ?? null)
        // Don't show link for deleted variants
        const href = isDeleted ? null : explicitHref

        return (
            <div className="flex items-center gap-2">
                <ReferenceTag
                    label={label}
                    href={href ?? undefined}
                    tooltip={isDeleted ? `Variant ${revisionId} was deleted` : label}
                    copyValue={revisionId ?? undefined}
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

/**
 * Generic variant reference text (no tag styling, just text).
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const VariantReferenceText = memo(
    ({
        revisionId,
        projectId,
        fallback,
    }: {
        revisionId: string | null
        projectId: string | null
        fallback?: string
    }) => {
        const queryAtom = useMemo(
            () => variantConfigAtomFamily({projectId, revisionId}),
            [projectId, revisionId],
        )
        const query = useAtomValue(queryAtom)

        if (!revisionId) {
            return <Text type="secondary">{fallback ?? "—"}</Text>
        }

        if (query.isPending || query.isFetching) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        const label = ref?.variantName ?? ref?.revisionId ?? revisionId

        return <Text>{label}</Text>
    },
)

/**
 * Generic evaluator reference label that fetches and displays an evaluator reference.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const EvaluatorReferenceLabel = memo(
    ({
        evaluatorId,
        evaluatorSlug,
        projectId,
        href: explicitHref,
    }: {
        evaluatorId?: string | null
        evaluatorSlug?: string | null
        projectId: string | null
        href?: string | null
    }) => {
        const queryAtom = useMemo(
            () => evaluatorReferenceAtomFamily({projectId, slug: evaluatorSlug, id: evaluatorId}),
            [projectId, evaluatorSlug, evaluatorId],
        )
        const query = useAtomValue(queryAtom)

        if (!evaluatorId && !evaluatorSlug) {
            return <Text type="secondary">—</Text>
        }

        if ((query.isPending || query.isFetching) && !query.isError) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        // If we have an ID/slug but no name, or query errored, the evaluator was likely deleted
        const isDeleted = Boolean(query.isError || ((ref?.id || ref?.slug) && !ref?.name))
        const displayId = evaluatorId ?? evaluatorSlug ?? ref?.id ?? ref?.slug ?? ""
        const label = isDeleted
            ? "Deleted"
            : (ref?.name ?? ref?.slug ?? ref?.id ?? evaluatorSlug ?? evaluatorId ?? "—")
        // Don't show link for deleted evaluators
        const href = isDeleted ? null : explicitHref

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={isDeleted ? `Evaluator ${displayId} was deleted` : label}
                copyValue={displayId}
                className="max-w-[220px] w-fit"
                tone="evaluator"
            />
        )
    },
)

/**
 * Generic query reference label that fetches and displays a query reference.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const QueryReferenceLabel = memo(
    ({
        queryId,
        querySlug,
        projectId,
        href: explicitHref,
    }: {
        queryId?: string | null
        querySlug?: string | null
        projectId: string | null
        href?: string | null
    }) => {
        const queryAtom = useMemo(
            () => queryReferenceAtomFamily({projectId, queryId, querySlug}),
            [projectId, queryId, querySlug],
        )
        const query = useAtomValue(queryAtom)

        if (!queryId && !querySlug) {
            return <Text type="secondary">—</Text>
        }

        if ((query.isPending || query.isFetching) && !query.isError) {
            return <Skeleton.Input active size="small" style={{width: 140}} />
        }

        const ref = query.data
        // If we have an ID/slug but no name, or query errored, the query was likely deleted
        const isDeleted = Boolean(query.isError || ((ref?.id || ref?.slug) && !ref?.name))
        const displayId = queryId ?? querySlug ?? ref?.id ?? ref?.slug ?? ""
        const label = isDeleted
            ? "Deleted"
            : (ref?.name ?? ref?.slug ?? ref?.id ?? querySlug ?? queryId ?? "—")
        // Don't show link for deleted queries
        const href = isDeleted ? null : explicitHref

        return (
            <ReferenceTag
                label={label}
                href={href ?? undefined}
                tooltip={isDeleted ? `Query ${displayId} was deleted` : label}
                copyValue={displayId}
                className="max-w-[220px]"
                tone="query"
            />
        )
    },
)
